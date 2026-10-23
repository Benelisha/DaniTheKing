import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getStorage} from 'firebase-admin/storage';

// URL order is part of source identity; prompt notes do not invalidate observed browser evidence.
export function researchKey(examples:{websiteUrl:string}[]){
 return createHash('sha256').update(JSON.stringify({version:1,urls:examples.map(e=>e.websiteUrl)})).digest('hex');
}
export function validResearch(references:any,examples:{websiteUrl:string}[]){
 return Array.isArray(references)&&references.length===examples.length&&references.every((r,i)=>r.websiteUrl===examples[i].websiteUrl)&&references.filter(r=>r.observed&&r.visualEvidence?.colors?.length&&r.screenshotObject).length>=3;
}
// Store immutable browser evidence privately, and materialize screenshots for each model call.
export async function savedCompetitorResearch(database:any,leadId:string,examples:{websiteUrl:string}[],dir:string,capture:()=>Promise<any[]>){
 const key=researchKey(examples),ref=database.doc(`websiteStudios/${leadId}/research/${key}`);
 const prefix=`studioResearch/${leadId}/${key}`,bucket=getStorage().bucket();
 const checkpoint=(await ref.get()).data();
 if(checkpoint?.version===1&&checkpoint.object===`${prefix}/references.json`){
  try{
   const [json]=await bucket.file(checkpoint.object).download(),references=JSON.parse(json.toString());
   if(!validResearch(references,examples))throw Error('Invalid research checkpoint');
   const restored=await Promise.all(references.map(async(r:any,i:number)=>{
    const {screenshotObject,...entry}=r;
    if(entry.observed){if(screenshotObject!==`${prefix}/competitor-${i+1}.png`)throw Error('Invalid screenshot checkpoint');const [bytes]=await bucket.file(screenshotObject).download();entry.screenshot=path.join(dir,`competitor-${i+1}.png`);await writeFile(entry.screenshot,bytes);}
    return entry;
   }));
   await writeFile(path.join(dir,'competitors.json'),JSON.stringify(restored,null,2));
   console.log(`Studio research reused ${key}`);return restored;
  }catch(error){console.warn('Saved competitor evidence unavailable; recapturing selected websites.');}
 }
 const references=await capture();
 const saved=await Promise.all(references.map(async(r:any,i:number)=>{
  const {screenshot,...entry}=r;
  if(entry.observed&&screenshot){entry.screenshotObject=`${prefix}/competitor-${i+1}.png`;await bucket.file(entry.screenshotObject).save(await readFile(screenshot),{contentType:'image/png',resumable:false});}
  return entry;
 }));
 if(!validResearch(saved,examples))throw Error('At least three selected competitor websites must be inspectable. Replace inaccessible examples and retry.');
 await bucket.file(`${prefix}/references.json`).save(JSON.stringify(saved),{contentType:'application/json',resumable:false});
 await ref.set({version:1,key,object:`${prefix}/references.json`,websiteUrls:examples.map(e=>e.websiteUrl),observed:saved.filter(r=>r.observed).length,capturedAt:new Date().toISOString()});
 console.log(`Studio research saved ${key}`);return references;
}
