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
