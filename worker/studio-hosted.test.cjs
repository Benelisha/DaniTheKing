const test=require('node:test'),assert=require('node:assert/strict');
const {hosted}=require('./studio.cjs');
function database(revision=0){
 const rows=new Map([['siteJobs/test',{stage:'design',status:'queued',leadId:'lead',revision:0,actor:'test'}],['websiteStudios/lead',{revision,draft:{}}],['leads/lead',{businessName:'Test pool care',service:'Pool cleaning',location:'Phoenix',phone:'+16025550123'}]]);
 const doc=p=>({id:p.split('/').at(-1),get:async()=>({exists:rows.has(p),data:()=>rows.get(p)}),collection:()=>({doc:()=>doc('history/test')}),p});
 const tx={get:r=>r.get(),set:(r,v)=>rows.set(r.p,v),update:(r,v)=>rows.set(r.p,{...rows.get(r.p),...v}),delete:r=>rows.delete(r.p),create:(r,v)=>rows.set(r.p,v)};
 return {rows,doc,runTransaction:fn=>fn(tx)};
}
test('hosted design saves a durable result and duplicate delivery does not rerun it',async()=>{
 process.env.STUDIO_HOSTED='true';const db=database();let calls=0;
 const model=async(_dir,_file,schema,_prompt,images)=>{assert.deepEqual(images,[]);calls++;return schema.parse({accent:'#005544',background:'#ffffff',ink:'#112211',heroLayout:'split',cornerRadius:12,rationale:'Clear hierarchy and accessible color contrast.'});};
 await hosted(db,'test',model);assert.equal(calls,1);assert.equal(db.rows.get('siteJobs/test').status,'completed');assert.equal(db.rows.get('websiteStudios/lead').revision,1);assert.ok(db.rows.get('websiteStudios/lead').draft.design);assert.ok(!db.rows.has('internal/studioWorkerLock'));
 await hosted(db,'test',model);assert.equal(calls,1);
});
test('a stale job cannot overwrite newer edits',async()=>{
 const db=database(2);await hosted(db,'test',()=>{throw Error('Must not call model');});assert.equal(db.rows.get('siteJobs/test').status,'failed');assert.equal(db.rows.get('websiteStudios/lead').revision,2);
});
test('an active lease prevents another hosted delivery from running',async()=>{
 const db=database();db.rows.set('internal/studioWorkerLock',{workerId:'other',jobId:'other',until:Date.now()+120000});await assert.rejects(hosted(db,'test',()=>{}),/lease busy/);assert.equal(db.rows.get('siteJobs/test').status,'queued');
});
