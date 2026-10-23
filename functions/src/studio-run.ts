import {randomUUID} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {db} from './store';
import {examplesSchema} from './studio-domain';
import {facts,factsFingerprint} from './studio-facts';
import {remainingStages,runStages,terminalRun} from './studio-sequence';
import {enqueueStudio} from './studio-task';
const now=()=>new Date().toISOString();
const leaseMs=120000;
export const activeRun=(run:any)=>!!run&&!terminalRun.has(run.status);

// Starting twice attaches to the existing run; a request ID also survives a lost HTTP response.
export async function startStudioRun(leadId:string,revision:number,requestId:string,actor:string){
 const dispatch=await db().runTransaction(async tx=>{
  const studioRef=db().doc(`websiteStudios/${leadId}`),runRef=db().doc(`studioRuns/${requestId}`);
  const [studio,lead,requested]=await Promise.all([tx.get(studioRef),tx.get(db().doc(`leads/${leadId}`)),tx.get(runRef)]);
  if(!lead.exists||lead.data()!.removedAt)throw new HttpException('Lead unavailable',404);
  if(requested.exists){if(requested.data()!.leadId!==leadId)throw new HttpException('Request ID belongs to another studio',409);return {runId:requestId,created:false};}
  const s=studio.data()||{revision:0,draft:{}};
  const previous=s.runId?await tx.get(db().doc(`studioRuns/${s.runId}`)):null;
  if(activeRun(previous?.data()))return {runId:s.runId as string,created:false};
  const job=s.jobId?await tx.get(db().doc(`siteJobs/${s.jobId}`)):null;
  if(job?.exists&&!['completed','failed','cancelled'].includes(job.data()!.status))throw new HttpException('A step is already running',409);
  if((s.revision||0)!==revision)throw new HttpException('Studio changed. Reload and retry.',409);
  const stages=remainingStages({...s,invalidExamples:!!s.draft.examples&&!examplesSchema.safeParse(s.draft.examples).success});
  tx.create(runRef,{leadId,actor,status:stages.length?'queued':'completed',stages,steps:stages.map(stage=>({stage,status:'pending'})),activeStage:null,revision,expectedRevision:revision,factsFingerprint:factsFingerprint(facts(lead.data())),createdAt:now(),updatedAt:now(),leaseUntil:0});
  tx.set(studioRef,{...s,runId:requestId,updatedAt:now()});
  return {runId:requestId,created:stages.length>0};
 });
 const {runId}=dispatch;
 const ref=db().doc(`studioRuns/${runId}`);
 if(dispatch.created)try{await enqueueStudio(runId,true);}catch(error){
  // Never fall back to inline execution: the queue may have accepted the task already.
  await db().runTransaction(async tx=>{const r=await tx.get(ref);if(r.data()?.status==='queued')tx.update(ref,{status:'failed',error:'Could not start the worker. Press Generate all to resume saved work.',updatedAt:now()});});
 }
 return runId;
}
export async function stopStudioRun(leadId:string){
 await db().runTransaction(async tx=>{
  const studio=await tx.get(db().doc(`websiteStudios/${leadId}`));
  if(!studio.data()?.runId)return;
  const ref=db().doc(`studioRuns/${studio.data()!.runId}`),run=await tx.get(ref);
  if(activeRun(run.data()))tx.update(ref,{stopRequested:true,...(run.data()!.status==='queued'?{status:'cancelled',completedAt:now()}:{}),updatedAt:now()});
 });
}

// One Cloud Task owns the sequence. Each completed stage is a durable resume checkpoint.
export async function processStudioRun(runId:string){
 const ref=db().doc(`studioRuns/${runId}`),owner=randomUUID();
 const run=await db().runTransaction(async tx=>{
  const snapshot=await tx.get(ref),r=snapshot.data();
  if(!activeRun(r)||(r!.leaseUntil||0)>Date.now())return null;
  // An interrupted run is retried explicitly, never by automatically re-spending on AI.
  if(r!.status!=='queued')return null;
  const studio=await tx.get(db().doc(`websiteStudios/${r!.leadId}`));
  if(studio.data()?.runId!==runId){tx.update(ref,{status:'cancelled',updatedAt:now()});return null;}
  tx.update(ref,{status:'running',owner,startedAt:now(),updatedAt:now(),leaseUntil:Date.now()+leaseMs});return r!;
 });
 if(!run)return;
 // Fence every transition so an expired worker cannot advance a recovered run.
 const updateRun=async(patch:any)=>db().runTransaction(async tx=>{const r=await tx.get(ref);if(r.data()?.owner!==owner||!activeRun(r.data())||(r.data()!.leaseUntil||0)<Date.now())throw Error('Generation run lease lost');tx.update(ref,patch);});
 let lost=false;
 const heartbeat=setInterval(()=>{void db().runTransaction(async tx=>{const r=await tx.get(ref);if(r.data()?.owner!==owner||!activeRun(r.data()))throw Error('Generation run lease lost');tx.update(ref,{leaseUntil:Date.now()+leaseMs,updatedAt:now()});}).catch(()=>{lost=true;});},20000);
 try{
  const {queueStudioStage}=await import('./sites');const {processStudio}=await import('./studio-task');
  const finished=await runStages({stages:run.stages,active:async()=>{
   if(lost)throw Error('Generation run lease lost');
   const r=(await ref.get()).data();if(r?.owner!==owner||!activeRun(r))throw Error('Generation run superseded');return !r.stopRequested;
  },execute:async stage=>{
   const s=(await db().doc(`websiteStudios/${run.leadId}`).get()).data()!;
   const lead=await db().doc(`leads/${run.leadId}`).get();
   if(s.runId!==runId||!lead.exists||lead.data()!.removedAt||factsFingerprint(facts(lead.data()))!==run.factsFingerprint)throw Error('Business facts changed. Try again to start a new run.');
   const r=(await ref.get()).data()!;
   if(s.revision!==r.expectedRevision)throw Error('Studio changed during generation. Reload and retry.');
   await updateRun({activeStage:stage,steps:r.steps.map((step:any)=>step.stage===stage?{...step,status:'running',startedAt:now()}:step),updatedAt:now()});
   const state:any=await queueStudioStage(run.leadId,stage,{revision:s.revision},run.actor,runId);
   await updateRun({jobId:state.jobId});
   await processStudio(state.jobId);
   const job=(await db().doc(`siteJobs/${state.jobId}`).get()).data();
   if(job?.status!=='completed')throw Error(job?.error||'The worker stopped before saving this step. Try again to resume.');
   const latest=(await ref.get()).data()!;
   await updateRun({expectedRevision:s.revision+1,steps:latest.steps.map((step:any)=>step.stage===stage?{...step,status:'completed',completedAt:now()}:step),updatedAt:now()});
  }});
  const studio=(await db().doc(`websiteStudios/${run.leadId}`).get()).data()!;
  const ready=studio.draft?.review?.ready&&studio.draft?.reviewChecks?.passed;
  await updateRun({status:!finished?'cancelled':ready?'completed':'needs_review',activeStage:null,leaseUntil:0,completedAt:now(),updatedAt:now()});
 }catch(error){
  await db().runTransaction(async tx=>{const snapshot=await tx.get(ref),r=snapshot.data();if(r?.owner!==owner||!activeRun(r))return;const jobRef=r.jobId?db().doc(`siteJobs/${r.jobId}`):null,job=jobRef?await tx.get(jobRef):null;if(job?.exists&&!['completed','failed','cancelled'].includes(job.data()!.status))tx.update(jobRef!,{status:'failed',leaseOwner:null,error:'Generation run stopped. Try again to resume.',updatedAt:now()});tx.update(ref,{status:'failed',error:(error as Error).message.slice(0,1500),steps:r!.steps.map((step:any)=>step.status==='running'?{...step,status:'failed'}:step),leaseUntil:0,updatedAt:now()});});
 }finally{clearInterval(heartbeat);}
}

// The scheduler reports interrupted runs; resuming AI work always requires an explicit retry.
export async function recoverStudioRuns(){
 const runs=await db().collection('studioRuns').where('status','in',['queued','running']).get();
 for(const snapshot of runs.docs)await db().runTransaction(async tx=>{
  const r=await tx.get(snapshot.ref),run=r.data();
  if(!activeRun(run))return;
  const expired=run!.status==='queued'?Date.parse(run!.createdAt)<Date.now()-35*60*1000:(run!.leaseUntil||0)<Date.now();
  if(!expired)return;
  const jobRef=run!.jobId?db().doc(`siteJobs/${run!.jobId}`):null,job=jobRef?await tx.get(jobRef):null;
  tx.update(snapshot.ref,{status:'failed',error:'The worker was interrupted or could not start. Try again to resume saved work.',leaseUntil:0,updatedAt:now()});
  if(job?.exists&&!['completed','failed','cancelled'].includes(job.data()!.status))tx.update(jobRef!,{status:'failed',leaseOwner:null,error:'Generation run interrupted. Try again to resume.',updatedAt:now()});
 });
}
