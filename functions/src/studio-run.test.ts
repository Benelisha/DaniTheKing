import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from './store';
import * as task from './studio-task';
import * as sites from './sites';
import {startStudioRun,processStudioRun,stopStudioRun,recoverStudioRuns} from './studio-run';
import {facts,factsFingerprint} from './studio-facts';
import {generationStages} from './studio-sequence';
function fixture(t:any){
 const data=new Map<string,any>();
 const ref=(path:string):any=>({path,id:path.split('/').at(-1),get:async()=>snap(path),update:async(patch:any)=>{data.set(path,{...data.get(path),...patch});}});
 const snap=(path:string):any=>({exists:data.has(path),id:path.split('/').at(-1),ref:ref(path),data:()=>data.get(path)});
 const database={doc:ref,runTransaction:async(fn:any)=>fn({get:async(r:any)=>snap(r.path),create:(r:any,value:any)=>{assert.equal(data.has(r.path),false);data.set(r.path,value);},set:(r:any,value:any)=>data.set(r.path,value),update:(r:any,patch:any)=>{data.set(r.path,{...data.get(r.path),...patch});}}),collection:()=>({where:()=>({get:async()=>({docs:[...data.keys()].filter(p=>p.startsWith('studioRuns/')).map(snap)})})})};
 t.mock.method(store,'db',()=>database);
 const enqueue=t.mock.method(task,'enqueueStudio',async()=>{});
 data.set('leads/lead',{businessName:'Test Repairs',location:'Phoenix, AZ',phone:'+16025550123',service:'Home repairs'});
 data.set('websiteStudios/lead',{revision:0,draft:{}});
 t.mock.method(sites,'queueStudioStage',async(id:string,stage:string,body:any,actor:any,runId:any)=>{
  const s=data.get('websiteStudios/lead'),jobId=`job-${stage}`;
  assert.equal(body.revision,s.revision);assert.equal(runId,s.runId);
  data.set(`siteJobs/${jobId}`,{stage,runId,status:'queued'});data.set('websiteStudios/lead',{...s,jobId});return {jobId};
 });
 const complete=async(id:string)=>{
  const job=data.get(`siteJobs/${id}`),s=data.get('websiteStudios/lead');
  data.set(`siteJobs/${id}`,{...job,status:'completed'});
  data.set('websiteStudios/lead',{...s,revision:s.revision+1,draft:{...s.draft,[job.stage]:{ready:true},reviewChecks:{passed:true}}});
 };
 const execute=t.mock.method(task,'processStudio',complete);
 return {data,enqueue,execute,complete,run:()=>data.get('studioRuns/11111111-1111-4111-8111-111111111111')};
}
const id='11111111-1111-4111-8111-111111111111';
test('one queued backend run completes every stage without any browser requests; duplicate delivery is inert',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');
 assert.deepEqual(f.enqueue.mock.calls[0].arguments,[id,true]);
 await processStudioRun(id);assert.equal(f.run().status,'completed');assert.equal(f.execute.mock.calls.length,6);
 assert.ok(f.run().steps.every((s:any)=>s.status==='completed'));
 await processStudioRun(id);assert.equal(f.execute.mock.calls.length,6);
 await startStudioRun('lead',0,id,'tester');assert.equal(f.enqueue.mock.calls.length,1);
});
test('double start attaches to the live run without resetting outputs or creating another run',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');
 assert.equal(await startStudioRun('lead',0,'22222222-2222-4222-8222-222222222222','tester'),id);
 assert.equal(f.data.has('studioRuns/22222222-2222-4222-8222-222222222222'),false);
});
test('failed child stops downstream generation and retains the completed stage',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');
 const original=f.complete;
 f.execute.mock.mockImplementation(async(jobId:string)=>{if(jobId==='job-blueprint'){f.data.set(`siteJobs/${jobId}`,{status:'failed',error:'No source evidence'});return;}await original(jobId);});
 await processStudioRun(id);assert.equal(f.run().status,'failed');assert.match(f.run().error,/No source evidence/);assert.equal(f.execute.mock.calls.length,2);assert.ok(f.data.get('websiteStudios/lead').draft.examples);
});
test('stop request is durable, including before the worker starts',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');await stopStudioRun('lead');await processStudioRun(id);
 assert.equal(f.run().status,'cancelled');assert.equal(f.execute.mock.calls.length,0);
});
test('changed business facts prevent AI work',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');f.data.get('leads/lead').service='Roofing';await processStudioRun(id);
 assert.equal(f.run().status,'failed');assert.equal(f.execute.mock.calls.length,0);
});
test('a delivered task cannot take over another active worker lease',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');Object.assign(f.run(),{status:'running',leaseUntil:Date.now()+120000});await processStudioRun(id);
 assert.equal(f.execute.mock.calls.length,0);assert.equal(f.run().status,'running');
});
test('recovery marks an expired run and child failed without automatically repeating AI work',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');Object.assign(f.run(),{status:'running',jobId:'child',leaseUntil:Date.now()-1});f.data.set('siteJobs/child',{status:'running'});await recoverStudioRuns();
 assert.equal(f.run().status,'failed');assert.equal(f.data.get('siteJobs/child').status,'failed');assert.equal(f.execute.mock.calls.length,0);
});
test('stop during a stage saves that result and prevents the next stage',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');
 f.execute.mock.mockImplementation(async(jobId:string)=>{await stopStudioRun('lead');await f.complete(jobId);});
 await processStudioRun(id);assert.equal(f.run().status,'cancelled');assert.equal(f.execute.mock.calls.length,1);assert.equal(f.data.get('websiteStudios/lead').revision,1);
});
test('an honest failing review is needs_review, never a completed or published run',async t=>{
 const f=fixture(t);await startStudioRun('lead',0,id,'tester');
 f.execute.mock.mockImplementation(async(jobId:string)=>{await f.complete(jobId);if(jobId==='job-review')f.data.get('websiteStudios/lead').draft.review.ready=false;});
 await processStudioRun(id);assert.equal(f.run().status,'needs_review');assert.equal(f.data.has('publishedWebsites/lead'),false);
});
test('enqueue failure is explicit and an ambiguously accepted task cannot later spend on AI',async t=>{
 const f=fixture(t);f.enqueue.mock.mockImplementation(async()=>{throw Error('Connection timed out');});
 await startStudioRun('lead',0,id,'tester');assert.equal(f.run().status,'failed');await processStudioRun(id);assert.equal(f.execute.mock.calls.length,0);
});
