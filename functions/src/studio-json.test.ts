import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {validatedStudioJson} from './studio-task';
const schema=z.object({ready:z.boolean(),summary:z.string().min(5)});
test('malformed provider JSON gets one format repair, preserving the honest failing assessment',async()=>{
 let repairs=0;const source='{"ready":false, summary:"A source was inaccessible"}';
 const value=await validatedStudioJson(source,schema,async(raw,issues)=>{repairs++;assert.equal(raw,source);assert.ok(issues.length);return JSON.stringify({ready:false,summary:'A source was inaccessible'});});
 assert.equal(value.ready,false);assert.equal(repairs,1);
});
test('failed format repair cannot silently pass validation or trigger another retry',async()=>{
 let repairs=0;await assert.rejects(validatedStudioJson('{broken',schema,async()=>{repairs++;return '{still broken';}));assert.equal(repairs,1);
 await assert.rejects(validatedStudioJson('{"ready":"yes"}',schema,async()=>'{"ready":"yes"}'));
});
test('valid structured output requires no repair',async()=>{
 assert.equal((await validatedStudioJson('{"ready":true,"summary":"Checks passed"}',schema,async()=>{throw Error('Must not repair valid JSON');})).ready,true);
});
test('final review reads authoritative facts and the final render, excluding prior drafts and scores',async()=>{
 const {studioSourceFiles}=await import('./studio-task');
 assert.deepEqual(studioSourceFiles('review'),['business-facts.json','improved-site.json','competitors.json','after-checks.json']);
 assert.ok(!studioSourceFiles('review').includes('brief.json'));
 assert.ok(!studioSourceFiles('review').includes('rendered-before.json'));
 assert.ok(studioSourceFiles('improved').includes('business-facts.json'));
});
