import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingStages,runStages,generationStages} from './studio-sequence';
test('resume preserves completed stages and retries a failing review',()=>{
 assert.deepEqual(remainingStages({draft:{examples:[],blueprint:{}}}),generationStages.slice(2));
 const draft=Object.fromEntries(generationStages.map(s=>[s,{}]));
 assert.deepEqual(remainingStages({draft}),['review']);
 assert.deepEqual(remainingStages({draft:{...draft,review:{ready:true},reviewChecks:{passed:true}}}),[]);
 assert.deepEqual(remainingStages({draft,invalidExamples:true}),generationStages);
});
test('backend advances without a browser and stops immediately on a failed stage',async()=>{
 const stages:string[]=[];
 await assert.rejects(runStages({stages:generationStages,active:async()=>true,execute:async stage=>{stages.push(stage);if(stage==='brief')throw Error('Invalid brief');}}),/Invalid brief/);
 assert.deepEqual(stages,['examples','blueprint','brief']);
});
test('a persisted stop request prevents downstream work after the current checkpoint',async()=>{
 let active=true;const stages:string[]=[];
 assert.equal(await runStages({stages:generationStages,active:async()=>active,execute:async stage=>{stages.push(stage);active=false;}}),false);
 assert.deepEqual(stages,['examples']);
});
