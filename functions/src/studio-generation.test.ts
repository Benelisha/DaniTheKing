import test from 'node:test';
import assert from 'node:assert/strict';
import * as provider from './gemini';
import {studioText} from './studio-task';
import {managedSettingsSchema} from './managed-domain';
test('studio output and thinking limits do not change ordinary research requests',async t=>{
 t.mock.method(provider.geminiKey,'value',()=> 'test-key');const requests:any[]=[];
 t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}));});
 const config=managedSettingsSchema.parse({});await provider.gemini('prompt',config,'research');await provider.gemini('prompt',config,'text',[],{studio:true});
 assert.equal(requests[0].generationConfig.maxOutputTokens,16000);assert.equal(requests[0].generationConfig.thinkingConfig,undefined);
 assert.equal(requests[1].generationConfig.maxOutputTokens,32768);assert.equal(requests[1].generationConfig.thinkingConfig.thinkingBudget,2048);
 assert.deepEqual(provider.studioTextOptions('gemini-3.8-flash').thinkingConfig,{thinkingLevel:'low'});
});
test('studio retries a token-limited response once with the supported larger cap',async t=>{
 const caps:any[]=[];t.mock.method(provider,'gemini',async(_prompt:any,_config:any,_mode:any,_parts:any,options:any)=>{caps.push(options.maxOutputTokens);if(caps.length===1)throw Object.assign(Error('truncated'),{finishReason:'MAX_TOKENS'});return {text:'{}'} as any;});
 assert.equal((await studioText('prompt',managedSettingsSchema.parse({}))).text,'{}');assert.deepEqual(caps,[undefined,65536]);
});
test('blocked studio responses are not retried as token exhaustion',async t=>{
 let calls=0;t.mock.method(provider,'gemini',async()=>{calls++;throw Object.assign(Error('blocked'),{finishReason:'SAFETY'});});await assert.rejects(studioText('prompt',managedSettingsSchema.parse({})),/blocked/);assert.equal(calls,1);
});
test('incomplete-response diagnostics expose counts and reason without request or response contents',async t=>{
 t.mock.method(provider.geminiKey,'value',()=> 'private-test-key');const logs:any[]=[];t.mock.method(console,'warn',(...args:any[])=>{logs.push(args);});
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'private-response-text'}]}}],usageMetadata:{promptTokenCount:100,thoughtsTokenCount:2048,candidatesTokenCount:1000}})));
 await assert.rejects(provider.gemini('private-prompt-text',managedSettingsSchema.parse({}),'text',[],{studio:true}),(error:any)=>error.finishReason==='MAX_TOKENS');
 const logged=JSON.stringify(logs);assert.match(logged,/MAX_TOKENS/);assert.match(logged,/2048/);assert.doesNotMatch(logged,/private-/);
});
test('recitation regenerates research once with original summaries and preserves grounding tools',async t=>{
 t.mock.method(provider.geminiKey,'value',()=> 'test-key');
 t.mock.method(console,'warn',()=>{});
 const requests:any[]=[];
 t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{
  requests.push(JSON.parse(init.body));
  return new Response(JSON.stringify({candidates:[requests.length===1?{finishReason:'RECITATION',content:{parts:[{text:'blocked-source-copy'}]}}:{finishReason:'STOP',content:{parts:[{text:'{"examples":[]}'}]},groundingMetadata:{webSearchQueries:['local handyman']}}]}));
 });
 const result=await provider.gemini('Find five verified handyman websites. Return the required JSON.',managedSettingsSchema.parse({}),'research');
 assert.equal(result.text,'{"examples":[]}');assert.equal(requests.length,2);
 assert.deepEqual(requests[1].tools,requests[0].tools);assert.deepEqual(result.grounding.webSearchQueries,['local handyman']);
 assert.match(requests[1].contents[0].parts[0].text,/Find five verified handyman websites/);
 assert.match(requests[1].contents[0].parts[0].text,/do not quote or reproduce/);
 assert.doesNotMatch(JSON.stringify(requests[1]),/blocked-source-copy/);
});
test('recitation retry is bounded and provides an actionable error',async t=>{
 t.mock.method(provider.geminiKey,'value',()=> 'test-key');t.mock.method(console,'warn',()=>{});let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({candidates:[{finishReason:'RECITATION'}]}));});
 await assert.rejects(provider.gemini('prompt',managedSettingsSchema.parse({})),(error:any)=>error.finishReason==='RECITATION'&&/Retry this step/.test(error.message));
 assert.equal(calls,2);
});
test('safety, missing candidates and image recitation are not retried',async t=>{
 t.mock.method(provider.geminiKey,'value',()=> 'test-key');t.mock.method(console,'warn',()=>{});
 for(const [response,mode] of [[{candidates:[{finishReason:'SAFETY'}]},'research'],[{promptFeedback:{blockReason:'SAFETY'}},'text'],[{candidates:[{finishReason:'RECITATION'}]},'image']] as const){
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify(response));});
  await assert.rejects(provider.gemini('prompt',managedSettingsSchema.parse({}),mode));assert.equal(calls,1);mock.mock.restore();
 }
});
test('studio discovery has a bounded thinking budget, grounding tools and a larger output cap',async t=>{
 t.mock.method(provider.geminiKey,'value',()=> 'test-key');const requests:any[]=[];
 t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'[]'}]}}]}));});
 await studioText('Find five websites',managedSettingsSchema.parse({}),[],'research');
 assert.equal(requests[0].generationConfig.thinkingConfig.thinkingBudget,2048);
 assert.equal(requests[0].generationConfig.maxOutputTokens,32768);assert.ok(requests[0].tools.length);
 assert.equal(requests[0].generationConfig.responseMimeType,undefined);
});
test('studio discovery retries token exhaustion in research mode',async t=>{
 const calls:any[]=[];t.mock.method(provider,'gemini',async(_prompt:any,_config:any,mode:any,_parts:any,options:any)=>{calls.push({mode,cap:options.maxOutputTokens});if(calls.length===1)throw Object.assign(Error('output limit'),{finishReason:'MAX_TOKENS'});return {text:'[]'} as any;});
 await studioText('Find five websites',managedSettingsSchema.parse({}),[],'research');
 assert.deepEqual(calls,[{mode:'research',cap:undefined},{mode:'research',cap:65536}]);
});
