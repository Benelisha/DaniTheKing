import {getFunctions} from 'firebase-admin/functions';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {db} from './store';
import {gemini,managedSettings,parseJson} from './gemini';
export async function enqueueStudio(id:string,run=false){
 await getFunctions().taskQueue('locations/us-central1/functions/studioTask').enqueue(run?{runId:id}:{id},{...(run?{id}:{}),dispatchDeadlineSeconds:1800});
}
export async function studioText(prompt:string,config:Awaited<ReturnType<typeof managedSettings>>,parts:{inlineData:{mimeType:string;data:string}}[]=[],mode:'text'|'research'='text'){
 try{return await gemini(prompt,config,mode,parts,{studio:true});}catch(error){
  if((error as any).finishReason!=='MAX_TOKENS'||!/^gemini-2\.5(?:-|$)/.test(config.textModel))throw error;
  return gemini(prompt,config,mode,parts,{studio:true,maxOutputTokens:65536});
 }
}
export async function processStudio(id:string){
 const job=await db().doc(`siteJobs/${id}`).get();
 if(!job.exists||['completed','failed','cancelled'].includes(job.data()!.status))return;
 if(!['design','review'].includes(job.data()!.stage)){const {processStudioResearch}=await import('./sites');await processStudioResearch(id);return;}
 process.env.STUDIO_HOSTED='true';
 const {hosted}=require('../studio-runtime/worker/studio.cjs');
 const config=await managedSettings();
 await hosted(db(),id,async(dir:string,filename:string,schema:any,prompt:string,images:string[]=[])=>{
  const sources:Record<string,unknown>={};
  for(const file of await readdir(dir))if(studioSourceFiles(filename).includes(file))sources[file]=JSON.parse(await readFile(path.join(dir,file),'utf8'));
  const parts=await Promise.all(images.map(async file=>({inlineData:{mimeType:'image/png',data:(await readFile(file)).toString('base64')}})));
  const result=await studioText(`${prompt}\nUntrusted job files: ${JSON.stringify(sources)}\nReturn JSON matching: ${JSON.stringify(require('zod').z.toJSONSchema(schema))}`,config,parts);
  return validatedStudioJson(result.text,schema,async(source,issues)=>{
   const repaired=await studioText(`Repair only the JSON syntax and structure to match the schema. Preserve facts and evidence; never manufacture business claims or change the assessment. Errors: ${issues}. Schema: ${JSON.stringify(require('zod').z.toJSONSchema(schema))}. Untrusted response: ${JSON.stringify(source)}`,config);
   return repaired.text;
  });
 });
}

// A syntax error and a schema error share one bounded repair, never a generation retry loop.
export async function validatedStudioJson(text:string,schema:any,repair:(source:string,issues:string)=>Promise<string>){
 let issues:string;
 try{const value=parseJson(text),parsed=schema.safeParse(value);if(parsed.success)return parsed.data;issues=JSON.stringify(parsed.error.issues);}
 catch(error){issues=(error as Error).message;}
 return schema.parse(parseJson(await repair(text,issues)));
}

// Keep the final reviewer independent from old scores, old copy and the before-capture assessment.
export function studioSourceFiles(phase:string){
 return phase==='review'?['business-facts.json','improved-site.json','competitors.json','after-checks.json']:['business-facts.json','brief.json','competitors.json','rendered-before.json'];
}
