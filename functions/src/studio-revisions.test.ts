import test from 'node:test';
import assert from 'node:assert/strict';
import {SitesController} from './sites';
import * as store from './store';
import * as tasks from './studio-task';
const leadId='a'.repeat(32),requestId='12345678-1234-4234-8234-123456789abc';
const examples=Array.from({length:5},(_,i)=>({businessName:`Business ${i}`,websiteUrl:`https://business${i}.com`,notes:'Observed navigation and contact details.'}));
function fixture(t:any){
 const draft={examples,blueprint:{summary:'A complete website grounded in competitor research.',visualDirection:'Clear accessible local business website design.',competitors:examples.map(e=>({websiteUrl:e.websiteUrl,accessible:true,observations:'Observed the actual business website.',patterns:[]})),sections:['services','reviews','process','faq','contact'].map((kind,i)=>({id:kind,kind,title:kind,purpose:'Help visitors find information.',requirements:'Show useful detailed information.',referenceUrls:[examples[i].websiteUrl],imageBrief:''}))},brief:{direction:'Clear local service website.',audience:'Homeowners',sections:'Services and contact',features:['contact']},content:{headline:'Local pool cleaning',intro:'Contact our local pool cleaning business.',imageUrl:'https://example.com/hero.webp',services:[{title:'Cleaning',description:'Local pool cleaning service.'}],about:'A local cleaning business.',cta:'Call us'},design:{accent:'#145a42',background:'#ffffff',ink:'#142d25',heroLayout:'split',cornerRadius:12,rationale:'An accessible local service website.'},review:{ready:true},reviewChecks:{passed:true}};
 const studio:any={revision:4,draft,revisionRequestCount:2};const records=new Map<string,any>();records.set(`websiteStudios/${leadId}`,studio);
 const snap=(p:string)=>({exists:records.has(p),data:()=>records.get(p)});
 const database:any={doc:(path:string)=>({path,get:async()=>snap(path)}),runTransaction:async(fn:any)=>fn({get:async(ref:any)=>snap(ref.path),create:(ref:any,data:any)=>{assert.equal(records.has(ref.path),false);records.set(ref.path,data);},set:(ref:any,data:any)=>records.set(ref.path,data)})};
 t.mock.method(store,'db',()=>database);const enqueued:string[]=[];t.mock.method(tasks,'enqueueStudio',async(id:string)=>{enqueued.push(id);});
 const controller=new SitesController();t.mock.method(controller,'read',async()=>({...records.get(`websiteStudios/${leadId}`),job:null,revisionRequests:[]}));return {controller,records,enqueued,studio};
}
test('revision request queues instructions, counts once, invalidates approval and survives a retry',async t=>{
 const {controller,records,enqueued}=fixture(t);const body={revision:4,instructions:'  Make the headline smaller.  ',requestId};
 const result=await controller.generate(leadId,'review',body,{actor:'tester'});
 assert.equal(result.revisionRequestCount,3);assert.equal(result.draft.review,undefined);assert.equal(result.draft.reviewChecks,undefined);
 const request=records.get(`websiteStudios/${leadId}/revisionRequests/${requestId}`);assert.equal(request.number,3);assert.equal(request.instructions,'Make the headline smaller.');
 const job=records.get(`siteJobs/${request.jobId}`);assert.equal(job.instructions,request.instructions);assert.equal(job.requestId,requestId);assert.equal(job.stage,'review');assert.equal(enqueued.length,1);
 await controller.generate(leadId,'review',body,{actor:'tester'});assert.equal(enqueued.length,1);assert.equal(records.get(`websiteStudios/${leadId}`).revisionRequestCount,3);
});
test('revision requests reject empty input, wrong stage and stale drafts without counting',async t=>{
 const {controller,records}=fixture(t);
 for(const [stage,body] of [['review',{revision:4,instructions:' ',requestId}],['design',{revision:4,instructions:'Change the headline',requestId}],['review',{revision:3,instructions:'Change the headline',requestId}]] as const)await assert.rejects(controller.generate(leadId,stage,body,{actor:'tester'}));
 assert.equal(records.size,1);assert.equal(records.get(`websiteStudios/${leadId}`).revisionRequestCount,2);
});
