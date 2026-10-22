// Local-only worker. No inbound network listener and no credentials sent to the browser.
const {connect}=require('./auth.cjs');
const { randomUUID } = require('node:crypto');
const { prompt,buildPage,reserveCost,PROMPT_VERSION } = require('./page.cjs');
const { inspectReferences,validateRendered } = require('./browser.cjs');
const { ensureSite,publish,PROJECT } = require('./hosting.cjs');
const { verified } = require('../functions/lib/generation');
const workerId = randomUUID();
const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
const pricing = model === 'gpt-5-mini' ? {input:.25,output:2} : {input:Number(process.env.OPENAI_INPUT_USD_PER_MILLION),output:Number(process.env.OPENAI_OUTPUT_USD_PER_MILLION)};
const MAX_OUTPUT = 16000;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let database,auth,stopping=false;
async function main() {
  if (!process.argv.includes('--setup') && !process.env.OPENAI_API_KEY) throw Error('Set OPENAI_API_KEY in the ignored .env.worker file before starting the generator.');
  if (!Number.isFinite(pricing.input) || pricing.input<=0 || !Number.isFinite(pricing.output) || pricing.output<=0) throw Error('Configure positive model input/output prices before using a different model.');
  ({database,auth}=await connect());
  await ensureSite(auth);
  if (process.argv.includes('--setup')) { console.log('Prospect Hosting site is ready.'); return; }
  const heartbeat = async () => database.doc('internal/generatorWorker').set({workerId,heartbeatAt:Date.now(),ready:true});
  await heartbeat();
  const timer=setInterval(()=>heartbeat().catch(()=>{}),20000);
  let wake;
  const stopListen=database.collection('generations').where('status','==','queued').onSnapshot(()=>wake?.(),e=>console.error('Queue listener interrupted:',e.code || 'connection error'));
  console.log('Generator online; waiting for jobs.');
  try {
    while (!stopping) {
      const candidates=await database.collection('generations').where('status','in',['queued','researching','generating','validating','publishing']).limit(50).get();
      const jobs=candidates.docs.sort((a,b)=>a.data().createdAt.localeCompare(b.data().createdAt));
      let processed=false;
      for (const doc of jobs) { if (await claim(doc.ref)) { await processJob(doc.ref); processed=true; break; } }
      if (!processed) await new Promise(r=>{const t=setTimeout(()=>{wake=null;r();},15000);wake=()=>{clearTimeout(t);wake=null;r();};});
    }
  } finally {clearInterval(timer);stopListen(); await database.doc('internal/generatorWorker').set({heartbeatAt:0,ready:false},{merge:true});}
}
const queue=require('./queue.cjs');
const claim=ref=>queue.claim(database,ref,workerId);
const fenced=(ref,patch={},renew=false)=>queue.fenced(database,ref,workerId,patch,renew);
async function checkIdentity(ref) {
  await fenced(ref);
  const job=(await ref.get()).data();
  const [lead,v]=await Promise.all([database.doc(`leads/${job.leadId}`).get(),database.doc(`googleVerifications/${job.leadId}`).get()]);
  if (!lead.exists || !verified(lead.data(),v.data()) || v.data().identityFingerprint!==job.snapshot.identityFingerprint || lead.data().callStatus==='Do not call') throw Error('Business identity or verification changed; review the lead and start a fresh generation.');
}
async function processJob(ref) {
  let leaseLost=false;
  const renewal=setInterval(()=>fenced(ref,{},true).catch(()=>{leaseLost=true;}),20000);
  const check=async()=>{if(leaseLost)throw Error('Worker lease lost');await checkIdentity(ref);};
  const stage=async status=>{await fenced(ref,{status});const j=(await ref.get()).data();await database.doc(`leads/${j.leadId}`).update({generationStatus:status});};
  try {
    await check();
    let job=(await ref.get()).data();
    let artifact=(await ref.collection('artifacts').doc('page').get()).data();
    if (!artifact) {
      const existing=await ref.collection('references').get();
      let references=existing.docs.sort((a,b)=>a.id.localeCompare(b.id)).map(d=>d.data());
      if (references.length!==5) {
        await stage('researching');
        references=await inspectReferences(job.snapshot,async(i,data)=>{await check();await ref.collection('references').doc(String(i)).set(data);});
      }
      let errors=[];
      for (;;) {
        job=(await ref.get()).data();
        const rawRef=ref.collection('artifacts').doc(`response-${job.attempts}`);
        let raw=(await rawRef.get()).data()?.response;
        if (!raw) {
          if (job.inFlight) throw Error('Previous GPT request ended without a saved response. Its budget reservation is retained; retry explicitly to continue.');
          if (job.attempts>=2) throw Error(`Generation failed validation after one repair: ${errors.join('; ') || job.validationErrors?.join('; ') || 'invalid output'}`);
          await stage('generating');
          const instructions=prompt(job.snapshot,references.map(({url,analysis})=>({url,...analysis})),errors.length ? errors : job.validationErrors || []);
          const reserved=reserveCost(instructions,5,pricing,MAX_OUTPUT);
          if ((job.spentUsd||0)+(job.reservedUsd||0)+reserved>job.budgetUsd) throw Error('The $1 generation budget cannot cover another request.');
          await fenced(ref,{attempts:job.attempts+1,inFlight:true,reservedUsd:(job.reservedUsd||0)+reserved,model,pricing,promptVersion:PROMPT_VERSION});
          await ref.collection('artifacts').doc(`prompt-${job.attempts+1}`).set({text:instructions});
          const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(240000),body:JSON.stringify({model,store:false,max_output_tokens:MAX_OUTPUT,reasoning:{effort:'low'},input:[{role:'user',content:[{type:'input_text',text:instructions},...references.map(r=>({type:'input_image',image_url:`data:image/jpeg;base64,${r.screenshot}`,detail:'low'}))]}],text:{format:{type:'json_schema',name:'landing_page',strict:true,schema:{type:'object',properties:Object.fromEntries(['title','description','body','css'].map(k=>[k,{type:'string'}])),required:['title','description','body','css'],additionalProperties:false}}}})});
          if(!response.ok) throw Error(`OpenAI returned HTTP ${response.status}. Check API key, credits and model access. Reserved budget remains protected.`);
          raw=await response.json();
          await check();
          const cost=((raw.usage?.input_tokens||0)*pricing.input+(raw.usage?.output_tokens||0)*pricing.output)/1e6;
          await database.runTransaction(async tx=>{
            const lock=await tx.get(database.doc('internal/generatorLock'));
            if(lock.data()?.workerId!==workerId || lock.data()?.jobId!==ref.id || lock.data()?.until<Date.now())throw Error('Worker lease lost before saving response');
            tx.set(ref.collection('artifacts').doc(`response-${job.attempts+1}`),{response:raw});
            tx.update(ref,{inFlight:false,spentUsd:(job.spentUsd||0)+cost,reservedUsd:job.reservedUsd||0,lastUsage:raw.usage||{},lastResponseId:raw.id||null});
          });
        }
        await stage('validating');
        try {
          if(raw.status!=='completed')throw Error('Model output was incomplete or refused.');
          const text=(raw.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
          artifact=buildPage(JSON.parse(text),job.snapshot,ref.id);
          const checked=await validateRendered(artifact.html);
          if(checked.errors.length)throw Error(checked.errors.join('; '));
          await check();
          await ref.collection('artifacts').doc('page').set({...artifact,validatedAt:new Date().toISOString()});
          for(const image of checked.screenshots)await ref.collection('artifacts').doc(`preview-${image.width}`).set(image);
          break;
        }catch(e){errors=[e.message];await fenced(ref,{validationErrors:errors});
          // A saved response has been consumed; prevent repeatedly validating it on resume.
          const current=(await ref.get()).data();
          await ref.collection('artifacts').doc(`response-${current.attempts}`).set({consumed:true},{merge:true});
          if(current.attempts>=2)throw Error(`Page failed validation: ${e.message}`);
          await fenced(ref,{needsRepair:true});
          // Next pass must make one repair request, not reuse the invalid response.
          await ref.collection('artifacts').doc(`response-${current.attempts}`).update({response:null});
        }
      }
    }
    await stage('publishing');await check();
    job=(await ref.get()).data();
    const url=await publish(auth,job.leadId,artifact,ref.id,patch=>fenced(ref,patch),check);
    await database.runTransaction(async tx=>{
      const leadRef=database.doc(`leads/${job.leadId}`),lock=database.doc('internal/generatorLock');
      const [l,v,k]=await Promise.all([tx.get(leadRef),tx.get(database.doc(`googleVerifications/${job.leadId}`)),tx.get(lock)]);
      if(k.data()?.workerId!==workerId || k.data()?.until<Date.now() || !verified(l.data(),v.data()) || v.data().identityFingerprint!==job.snapshot.identityFingerprint)throw Error('Verification or worker lease changed before completion.');
      tx.update(ref,{status:'completed',publishedUrl:url,updatedAt:new Date().toISOString(),error:null});
      tx.update(leadRef,{generatedWebsiteUrl:url,generationStatus:'completed'});
    });
    console.log(`Published ${url}`);
  } catch(e) {
    const error=String(e.message).slice(0,1500);
    console.error(`Job ${ref.id}: ${error}`);
    try { await fenced(ref,{status:'failed',error});const j=(await ref.get()).data();await database.doc(`leads/${j.leadId}`).update({generationStatus:'failed'}); }catch{}
  } finally {
    clearInterval(renewal);
    await database.runTransaction(async tx=>{const r=database.doc('internal/generatorLock'),s=await tx.get(r);if(s.data()?.workerId===workerId&&s.data()?.jobId===ref.id)tx.delete(r);}).catch(()=>{});
  }
}
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
