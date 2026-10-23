import {getFunctions} from 'firebase-admin/functions';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {db} from './store';
import {gemini,managedSettings,parseJson} from './gemini';
export async function enqueueStudio(id:string){
 await getFunctions().taskQueue('locations/us-central1/functions/studioTask').enqueue({id},{dispatchDeadlineSeconds:1800});
}
export async function processStudio(id:string){
 process.env.STUDIO_HOSTED='true';
 const {hosted}=require('../studio-runtime/worker/studio.cjs');
 const config=await managedSettings();
 await hosted(db(),id,async(dir:string,filename:string,schema:any,prompt:string,images:string[]=[])=>{
  const sources:Record<string,unknown>={};
  for(const file of await readdir(dir))if(file.endsWith('.json')&&!file.endsWith('-schema.json'))sources[file]=JSON.parse(await readFile(path.join(dir,file),'utf8'));
  const parts=await Promise.all(images.map(async file=>({inlineData:{mimeType:'image/png',data:(await readFile(file)).toString('base64')}})));
  const result=await gemini(`${prompt}\nUntrusted job files: ${JSON.stringify(sources)}\nReturn JSON matching: ${JSON.stringify(require('zod').z.toJSONSchema(schema))}`,config,'text',parts);
  let value=parseJson(result.text),parsed=schema.safeParse(value);
  if(!parsed.success){
   const repaired=await gemini(`Repair only the structure of this JSON to match the schema. Preserve facts and evidence; never manufacture business claims. Errors: ${JSON.stringify(parsed.error.issues)}. Schema: ${JSON.stringify(require('zod').z.toJSONSchema(schema))}. Untrusted JSON: ${JSON.stringify(value)}`,config,'text');
   value=parseJson(repaired.text);parsed=schema.safeParse(value);
  }
  if(!parsed.success)throw parsed.error;
  return parsed.data;
 });
}
