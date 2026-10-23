import {db} from './store';
import {savedCompetitorResearch} from './studio-research';
import {exampleSchema} from './studio-domain';
import {z} from 'zod';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

export async function verifyExampleWebsites(examples:z.infer<typeof exampleSchema>[]){
 // Reuse the worker's public DNS gate before accepting provider-supplied URLs.
 process.env.STUDIO_HOSTED='true';
 const {readPublic}=require('../studio-runtime/worker/browser.cjs');
 for(const example of examples){
  try{
   let url=example.websiteUrl,response:any;
   for(let redirects=0;redirects<6;redirects++){
    response=await readPublic(url);
    if(response.status>=300&&response.status<400&&response.headers.location){url=new URL(response.headers.location,url).href;continue;}
    break;
   }
   if(response.status!==200||!response.headers['content-type']?.includes('text/html')||response.body.length<250)throw Error('Website unavailable');
  }catch{
   throw Error(`Could not verify the competitor website for ${example.businessName}. Retry Examples or enter five real business websites manually.`);
  }
 }
}
export async function inspectExampleWebsites(leadId:string,examples:z.infer<typeof exampleSchema>[]){
 process.env.STUDIO_HOSTED='true';
 const quality=require('../studio-runtime/worker/studio-quality.cjs');
 const dir=await mkdtemp(path.join(tmpdir(),'studio-research-'));
 let browser:any;
 try{
  browser=await quality.openBrowser();
  const refs=await savedCompetitorResearch(db(),leadId,examples,dir,()=>quality.references(browser,examples,dir));
  if(!refs.some((r:any)=>r.observed))throw Error('Competitor websites could not be inspected. Replace inaccessible examples and retry.');
  const parts=await Promise.all(refs.filter((r:any)=>r.screenshot).map(async(r:any)=>({inlineData:{mimeType:'image/png',data:(await readFile(r.screenshot)).toString('base64')}})));
  return {references:refs.map(({screenshot,...ref}:any)=>ref),parts};
 }finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
}
