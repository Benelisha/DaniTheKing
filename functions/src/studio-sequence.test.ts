import test from 'node:test';
import assert from 'node:assert/strict';
import {generateAll,generationStages} from './studio-sequence';
function fixture(){
 let state:any={revision:0,draft:{}};const stages:string[]=[];let active=true;
 return {stages,stop:()=>{active=false;},options:{initial:state,active:()=>active,wait:async()=>{},update:()=>{},read:async()=>{state={...state,revision:state.revision+1,job:{status:'completed'},draft:{...state.draft,[stages.at(-1)!]:{ready:true},reviewChecks:{passed:true}}};return state;},generate:async(stage:string,revision:number)=>{assert.equal(revision,state.revision);stages.push(stage);state={...state,jobId:stage,job:{status:'queued'}};return state;}}};
}
test('browser sequence waits for each job and uses its resulting revision through review',async()=>{const f=fixture();await generateAll(f.options);assert.deepEqual(f.stages,generationStages);});
test('closing or stopping prevents the next step from being started',async()=>{const f=fixture();f.options.wait=async()=>{f.stop();};await generateAll(f.options);assert.deepEqual(f.stages,['examples']);});
test('failed generation stops all downstream steps',async()=>{const f=fixture();f.options.read=async()=>({jobId:'examples',job:{status:'failed',error:'No evidence'}});await assert.rejects(generateAll(f.options),/No evidence/);assert.deepEqual(f.stages,['examples']);});
test('existing examples are preserved when generating remaining stages',async()=>{const f=fixture();f.options.initial.draft.examples=[{}];await generateAll(f.options);assert.deepEqual(f.stages,generationStages.slice(1));});
test('another window replacing the job stops the sequence',async()=>{const f=fixture();f.options.read=async()=>({jobId:'other',job:{status:'completed'}});await assert.rejects(generateAll(f.options),/another window/);});

test('a completed but failing quality review stops for attention',async()=>{
 const f=fixture();for(const stage of generationStages.slice(0,-1))f.options.initial.draft[stage]={};
 const read=f.options.read;f.options.read=async()=>{const state=await read();state.draft.review.ready=false;return state;};
 await assert.rejects(generateAll(f.options),/Quality review needs attention/);assert.deepEqual(f.stages,['review']);
});
test('invalid saved examples restart discovery rather than reusing bad sources',async()=>{
 const f=fixture();f.options.initial.invalidExamples=true;f.options.initial.draft.examples=[{}];
 await generateAll(f.options);assert.deepEqual(f.stages,generationStages);
});
