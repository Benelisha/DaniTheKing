import test from 'node:test';
import assert from 'node:assert/strict';
import {SitesController,processStudioResearch} from './sites';
import * as store from './store';
import * as provider from './gemini';
import * as examplesProvider from './studio-examples';
import {examplesSchema} from './studio-domain';
import {facts} from './studio-facts';
import {managedSettingsSchema} from './managed-domain';
const id='a'.repeat(32),jobId='12345678-1234-4234-8234-123456789abc';
const examples=Array.from({length:5},(_,i)=>({businessName:`Business ${i}`,websiteUrl:`https://business${i}.com`,notes:'Handyman services and contact navigation.'}));
function fixture(t:any){
 const lead={businessName:'Handy Guys',service:'Handyman',location:'FL',phone:'5555555555'};
 const records=new Map<string,any>([[`leads/${id}`,lead],[`websiteStudios/${id}`,{revision:0,draft:{},jobId}],[`siteJobs/${jobId}`,{status:'queued',stage:'examples',leadId:id,revision:0,actor:'tester'}]]);
 const snap=(path:string)=>({exists:records.has(path),data:()=>records.get(path)});
 const ref=(path:string):any=>({path,get:async()=>snap(path),update:async(patch:any)=>records.set(path,{...records.get(path),...patch}),collection:(name:string)=>({doc:()=>ref(`${path}/${name}/history`)})});
 const database:any={doc:ref,runTransaction:async(fn:any)=>fn({get:async(r:any)=>snap(r.path),update:(r:any,patch:any)=>records.set(r.path,{...records.get(r.path),...patch}),create:(r:any,data:any)=>records.set(r.path,data)})};
 t.mock.method(store,'db',()=>database);
 t.mock.method(SitesController.prototype,'read',async()=>({...records.get(`websiteStudios/${id}`),business:facts(lead)}));
 t.mock.method(provider,'managedSettings',async()=>managedSettingsSchema.parse({}));
 t.mock.method(examplesProvider,'verifyExampleWebsites',async()=>{});
 const prompts:string[]=[];t.mock.method(provider,'gemini',async(prompt:string)=>{prompts.push(prompt);return {text:JSON.stringify(examples)} as any;});
 return {records,prompts};
}
test('background research saves verified results once and omits visual-design requirements during discovery',async t=>{
 const {records,prompts}=fixture(t);await processStudioResearch(jobId);await processStudioResearch(jobId);
 assert.equal(prompts.length,1);assert.doesNotMatch(prompts[0],/every palette color/);
 assert.match(prompts[0],/Never fill the list with placeholders/);
 assert.equal(records.get(`siteJobs/${jobId}`).status,'completed');assert.equal(records.get(`websiteStudios/${id}`).revision,1);
 assert.deepEqual(records.get(`websiteStudios/${id}`).draft.examples,examples);
});
test('active leases prevent duplicate provider calls and stale jobs cannot overwrite edits',async t=>{
 const {records,prompts}=fixture(t);records.get(`siteJobs/${jobId}`).leaseUntil=Date.now()+60000;
 await assert.rejects(processStudioResearch(jobId),/already running/);assert.equal(prompts.length,0);
 records.get(`siteJobs/${jobId}`).leaseUntil=0;records.get(`websiteStudios/${id}`).revision=1;
 await processStudioResearch(jobId);assert.equal(prompts.length,0);assert.equal(records.get(`siteJobs/${jobId}`).status,'failed');assert.deepEqual(records.get(`websiteStudios/${id}`).draft,{});
});
test('unverifiable sites fail the background job without advancing the draft',async t=>{
 const {records}=fixture(t);t.mock.method(examplesProvider,'verifyExampleWebsites',async()=>{throw Error('Could not verify competitor');});
 await processStudioResearch(jobId);assert.equal(records.get(`siteJobs/${jobId}`).status,'failed');assert.equal(records.get(`websiteStudios/${id}`).revision,0);
});
test('missing-data reports and fabricated placeholder URLs cannot satisfy Examples',()=>{
 assert.equal(examplesSchema.safeParse(examples.map((e,i)=>({...e,businessName:`Missing Data Report ${i}`,websiteUrl:`https://data-not-extracted-${i}.com/entry1` }))).success,false);
});
test('blueprint receives browser screenshots and cannot claim inaccessible sources are observed',async t=>{
 const {records}=fixture(t);
 records.get(`websiteStudios/${id}`).draft={examples};records.get(`siteJobs/${jobId}`).stage='blueprint';
 const screenshot={inlineData:{mimeType:'image/png',data:'test-screenshot'}};
 t.mock.method(examplesProvider,'inspectExampleWebsites',async()=>({references:examples.map((e,i)=>({websiteUrl:e.websiteUrl,observed:i!==0,text:'Actual page observations'})),parts:[screenshot]}));
 t.mock.method(provider,'gemini',async(prompt:any,_config:any,mode:any,parts:any)=>{
  assert.equal(mode,'text');assert.deepEqual(parts,[screenshot]);assert.match(prompt,/Actual page observations/);
  return {text:JSON.stringify({summary:'A blueprint based on observed competitor sections.',visualDirection:'Observed typography, spacing and actual competitor palette.',competitors:examples.map(e=>({websiteUrl:e.websiteUrl,accessible:true,observations:'Observed competitor layout and services.',patterns:[]})),sections:['services','contact'].map(kind=>({id:kind,kind,title:kind,purpose:'Help a visitor find useful details.',requirements:'Provide original and useful website information.',referenceUrls:[examples[0].websiteUrl],imageBrief:''}))})} as any;
 });
 await processStudioResearch(jobId);
 assert.equal(records.get(`siteJobs/${jobId}`).status,'failed');assert.match(records.get(`siteJobs/${jobId}`).error,/inaccessible competitor/);
 assert.equal(records.get(`websiteStudios/${id}`).draft.blueprint,undefined);
});
