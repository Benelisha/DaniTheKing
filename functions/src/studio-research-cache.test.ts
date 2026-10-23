import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from 'firebase-admin/storage';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {researchKey,savedCompetitorResearch} from './studio-research';
const examples=Array.from({length:5},(_,i)=>({websiteUrl:`https://business-${i}.com/`}));
test('research source identity follows URLs and order, independent of edited notes',()=>{
 assert.equal(researchKey(examples),researchKey(examples.map(e=>({...e,notes:'Updated'}))));
 assert.notEqual(researchKey(examples),researchKey([...examples].reverse()));
 assert.notEqual(researchKey(examples),researchKey(examples.map((e,i)=>i?e:{websiteUrl:'https://replacement.com/'})));
});
test('saved text, palettes and screenshots survive workers and avoid a second competitor capture',async t=>{
 const objects=new Map<string,Buffer>(),docs=new Map<string,any>();let captures=0;
 t.mock.method(storage,'getStorage',()=>({bucket:()=>({file:(key:string)=>({save:async(value:any)=>{objects.set(key,Buffer.from(value));},download:async()=>{if(!objects.has(key))throw Error('Missing object');return [objects.get(key)];}})})}));
 const database={doc:(key:string)=>({get:async()=>({data:()=>docs.get(key)}),set:async(value:any)=>{docs.set(key,value);}})};
 const dir=await mkdtemp(path.join(tmpdir(),'research-test-'));
 try{
  const capture=(sources=examples)=>async()=>{captures++;return Promise.all(sources.map(async(e,i)=>{const screenshot=path.join(dir,`original-${i}.png`);await writeFile(screenshot,`image-${i}`);return {...e,observed:true,text:`Verified business ${i}`,visualEvidence:{colors:['#ffffff','#000000']},screenshot};}));};
  await savedCompetitorResearch(database,'lead',examples,dir,capture());
  const result=await savedCompetitorResearch(database,'lead',examples,dir,capture());
  assert.equal(captures,1);assert.equal(result[0].text,'Verified business 0');assert.equal((await readFile(result[0].screenshot)).toString(),'image-0');
  await savedCompetitorResearch(database,'lead',[...examples].reverse(),dir,capture([...examples].reverse()));assert.equal(captures,2);
  objects.delete(`studioResearch/lead/${researchKey(examples)}/competitor-1.png`);
  await savedCompetitorResearch(database,'lead',examples,dir,capture());assert.equal(captures,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
