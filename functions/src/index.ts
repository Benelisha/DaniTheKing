import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {geminiKey} from "./gemini";
import {processManaged} from "./managed";
import { initializeApp } from "firebase-admin/app";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createApi } from "./api";
import { discoveryCredentials, runDiscovery } from "./discovery";
import { scheduleSlot } from "./domain";
import { settings } from "./store";
initializeApp();
export const api = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 3,
    secrets: [discoveryCredentials,geminiKey],
    invoker: "public",
  },
  async (req, res) => {
    const app = await createApi();
    app(req, res);
  },
);
// A fixed tick lets the team change its three daily slots without redeploying.
export const discoverLeads = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "UTC",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
    retryCount: 0,
    secrets: [discoveryCredentials,geminiKey],
  },
  async (event) => {
    const config = await settings();
    const slot = scheduleSlot(new Date(event.scheduleTime), config);
    if (slot) await runDiscovery("schedule", `scheduled_${slot}`);
  },
);

export const managedTask=onTaskDispatched({region:"us-central1",timeoutSeconds:540,memory:"1GiB",secrets:[geminiKey],retryConfig:{maxAttempts:5,minBackoffSeconds:30,maxBackoffSeconds:300},rateLimits:{maxConcurrentDispatches:1}},async request=>{const id=request.data?.id;if(typeof id!=="string"||! /^[a-f0-9-]{36}$/.test(id))throw Error("Invalid job ID");await processManaged(id);});

// Recover a committed job if task creation or stage dispatch was interrupted.
export const recoverManagedJobs=onSchedule({schedule:"every 5 minutes",region:"us-central1",timeoutSeconds:120},async()=>{
 const {db}=await import('./store');const {enqueueManaged}=await import('./managed');
 const jobs=await db().collection('managedJobs').where('status','in',['queued','running']).limit(50).get();
 for(const job of jobs.docs)if((job.data().leaseUntil||0)<Date.now())await enqueueManaged(job.id);
});

// Cloud Tasks owns execution: closing the UI or sleeping a laptop has no effect.
export const studioTask=onTaskDispatched({region:'us-central1',timeoutSeconds:1800,memory:'2GiB',maxInstances:2,concurrency:1,secrets:[geminiKey],retryConfig:{maxAttempts:1},rateLimits:{maxConcurrentDispatches:1}},async request=>{
 if(request.data?.runId){const id=request.data.runId;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid studio run ID');const {processStudioRun}=await import('./studio-run');await processStudioRun(id);return;}
 const id=request.data?.id;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid studio job ID');
 const {processStudio}=await import('./studio-task');await processStudio(id);
});
export const recoverStudioJobs=onSchedule({schedule:'every 5 minutes',region:'us-central1',timeoutSeconds:120},async()=>{
 const {db}=await import('./store');const {enqueueStudio}=await import('./studio-task');
 const {recoverStudioRuns}=await import('./studio-run');await recoverStudioRuns();
 const lock=(await db().doc('internal/studioWorkerLock').get()).data();
 const jobs=await db().collection('siteJobs').where('status','in',['queued','running','building']).get();
 for(const job of jobs.docs)if(!job.data().runId&&!(lock?.jobId===job.id&&lock.until>Date.now())&&(job.data().leaseUntil||0)<Date.now()){
  if((job.data().attempts||0)>=5)await job.ref.update({status:'failed',error:'Hosted worker was interrupted repeatedly. Please retry this step.',updatedAt:new Date().toISOString()});
  else await enqueueStudio(job.id);
 }
});
