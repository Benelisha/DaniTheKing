const test=require('node:test'),assert=require('node:assert/strict');
const {hosted}=require('./studio.cjs');
function database(revision=0){
 const rows=new Map([['siteJobs/test',{stage:'design',status:'queued',leadId:'lead',revision:0,actor:'test'}],['websiteStudios/lead',{revision,jobId:'test',draft:{}}],['leads/lead',{businessName:'Test pool care',service:'Pool cleaning',location:'Phoenix',phone:'+16025550123'}]]);
 const doc=p=>({id:p.split('/').at(-1),update:async v=>rows.set(p,{...rows.get(p),...v}),get:async()=>({exists:rows.has(p),data:()=>rows.get(p)}),collection:name=>({doc:id=>doc(`${p}/${name}/${id||'test'}`)}),p});
 const tx={get:r=>r.get(),set:(r,v)=>rows.set(r.p,v),update:(r,v)=>rows.set(r.p,{...rows.get(r.p),...v}),delete:r=>rows.delete(r.p),create:(r,v)=>rows.set(r.p,v)};
 return {rows,doc,runTransaction:fn=>fn(tx)};
}
test('hosted design saves a durable result and duplicate delivery does not rerun it',async t=>{
 t.mock.method(require('../functions/lib/studio-research'),'savedCompetitorResearch',async(_db,_lead,_examples,_dir,capture)=>capture());
 const quality=require('./studio-quality.cjs');t.mock.method(quality,'openBrowser',async()=>({close:async()=>{}}));t.mock.method(quality,'references',async()=>[{websiteUrl:'https://competitor.example',observed:true,visualEvidence:{colors:['#005544','#ffffff','#112211']}}]);
 process.env.STUDIO_HOSTED='true';const db=database();let calls=0;
 const model=async(_dir,_file,schema,_prompt,images)=>{assert.deepEqual(images,[]);calls++;return schema.parse({visualStyle:'minimal',serviceLayout:'list',imageShape:'rounded',fontStyle:'modern',surface:'#ffffff',onAccent:'#ffffff',onInk:'#ffffff',accent:'#005544',background:'#ffffff',ink:'#112211',heroLayout:'split',cornerRadius:12,rationale:'Clear hierarchy and accessible color contrast.'});};
 await hosted(db,'test',model);assert.equal(calls,1);assert.equal(db.rows.get('siteJobs/test').status,'completed');assert.equal(db.rows.get('websiteStudios/lead').revision,1);assert.ok(db.rows.get('websiteStudios/lead').draft.design);assert.ok(!db.rows.has('internal/studioWorkerLock'));
 await hosted(db,'test',model);assert.equal(calls,1);
});
test('a stale job cannot overwrite newer edits',async()=>{
 const db=database(2);await hosted(db,'test',()=>{throw Error('Must not call model');});assert.equal(db.rows.get('siteJobs/test').status,'failed');assert.equal(db.rows.get('websiteStudios/lead').revision,2);
});
test('an active lease prevents another hosted delivery from running',async()=>{
 const db=database();db.rows.set('internal/studioWorkerLock',{workerId:'other',jobId:'other',until:Date.now()+120000});await assert.rejects(hosted(db,'test',()=>{}),/lease busy/);assert.equal(db.rows.get('siteJobs/test').status,'queued');
});
test('comparison identities and availability come from selected sources rather than model URLs',()=>{
 const {comparisonModelSchema,bindComparisons}=require('./studio.cjs');const examples=Array.from({length:5},(_,i)=>({websiteUrl:`https://source${i}.com`}));
 const report={summary:'A report grounded in selected browser evidence.',scores:{design:90,content:90,ux:90},comparisons:Object.fromEntries(examples.map((_,i)=>[`competitor${i+1}`,{websiteUrl:'https://wrong.example',observed:true,strengthsMatched:['Clear navigation'],remainingGaps:[]}])),sectionChecks:Array.from({length:5},(_,i)=>({id:'section'+i,passed:true,notes:'Checked'})),changes:[],blockers:[],ready:true};
 const parsed=comparisonModelSchema(examples).parse(report),bound=bindComparisons(parsed,examples,examples.map((e,i)=>({...e,observed:i<3})));
 assert.deepEqual(bound.comparisons.map(v=>v.websiteUrl),examples.map(v=>v.websiteUrl));assert.deepEqual(bound.comparisons.map(v=>v.observed),[true,true,true,false,false]);assert.deepEqual(bound.comparisons[4].strengthsMatched,[]);assert.ok(bound.comparisons[4].remainingGaps.length);assert.ok(!('websiteUrl' in parsed.comparisons.competitor1));
 delete report.comparisons.competitor5;assert.throws(()=>comparisonModelSchema(examples).parse(report));
});

test('failed revision jobs retain the request and mark it failed',async()=>{
 const db=database(2);db.rows.get('siteJobs/test').requestId='request';db.rows.set('websiteStudios/lead/revisionRequests/request',{number:1,status:'queued',instructions:'Make the headline smaller.'});
 await hosted(db,'test',()=>{throw Error('Must not call model');});
 assert.equal(db.rows.get('siteJobs/test').status,'failed');const request=db.rows.get('websiteStudios/lead/revisionRequests/request');assert.equal(request.status,'failed');assert.equal(request.number,1);assert.match(request.error,/draft changed/);
});
test('model design schema permits only observed colors and palette binding repairs contrast',()=>{
 const {designSchemaFor}=require('./studio.cjs');
 const colors=['#ffffff','#0a1b33','#faf9f6','#1e5eff'];
 const schema=designSchemaFor([{observed:true,visualEvidence:{colors}}]);
 const d={accent:'#1e5eff',background:'#ffffff',ink:'#0a1b33',surface:'#faf9f6',onAccent:'#ffffff',onInk:'#ffffff',heroLayout:'split',fontStyle:'modern',visualStyle:'bold',serviceLayout:'cards',imageShape:'rounded',cornerRadius:12,rationale:'A palette observed on the selected competitor website.'};
 assert.equal(schema.safeParse(d).success,true);
 assert.equal(schema.safeParse({...d,accent:'#153355'}).success,false);
 const quality=require('./studio-quality.cjs');
 const refs=[{websiteUrl:'https://reference.example',observed:true,visualEvidence:{colors}}];
 const repaired=quality.bindPalette({...d,ink:'#faf9f6',background:'#0a1b33'},refs);
 for(const [a,b] of [['onInk','ink'],['ink','background'],['ink','surface'],['onAccent','accent'],['accent','background'],['accent','surface']])assert.ok(quality.contrast(repaired[a],repaired[b])>=4.5);
 for(const token of ['accent','background','ink','surface','onAccent','onInk'])assert.ok(colors.includes(repaired[token]));
 assert.throws(()=>quality.bindPalette({...d,accent:'#ffffff',background:'#ffffff',ink:'#ffffff',surface:'#ffffff',onAccent:'#ffffff',onInk:'#ffffff'},[{observed:true,websiteUrl:'https://reference.example',visualEvidence:{colors:['#ffffff']}}]),/cannot satisfy/);
 const json=require('zod').z.toJSONSchema(schema);assert.deepEqual(json.properties.accent.enum,colors);
});
