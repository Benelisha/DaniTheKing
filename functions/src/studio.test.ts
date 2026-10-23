import test from 'node:test';
import assert from 'node:assert/strict';
import {businessSlug,examplesSchema,validateStage,studioSchema} from './studio-domain';
import {PublicSitesController} from './sites';
import * as store from './store';
const examples=Array.from({length:5},(_,i)=>({businessName:`Business ${i}`,websiteUrl:`https://business${i}.com`,notes:'Observed website layout and contact information.'}));
test('studio permits incomplete drafts but requires five distinct examples before analysis',()=>{
 assert.deepEqual(studioSchema.parse({}),{});assert.doesNotThrow(()=>validateStage('examples',{}));assert.throws(()=>validateStage('analysis',{}));assert.doesNotThrow(()=>validateStage('analysis',{examples}));assert.equal(examplesSchema.safeParse([...examples.slice(0,4),examples[0]]).success,false);
});
test('publishing requires reviewed content and design, with stable business paths',()=>{
 assert.throws(()=>validateStage('publish',{examples}));assert.equal(businessSlug('Chrome Pools LLC','abcdef1234'),'chrome-pools-llc-abcdef');assert.equal(businessSlug('Café & Pool','123456789'),'cafe-pool-123456');assert.notEqual(businessSlug('Same','aaaaaa'),businessSlug('Same','bbbbbb'));
});
test('removed leads cannot serve published website content even if a document remains',async t=>{
 t.mock.method(store,'db',()=>({doc:(p:string)=>({get:async()=>({exists:true,data:()=>p.startsWith('published')?{leadId:'a'.repeat(32)}:{removedAt:'2026-10-23'}})})}) as any);
 await assert.rejects(new PublicSitesController().website('removed-business'),/no longer available/);
});

test('broken or untrusted generated image URLs use a known stock fallback',async t=>{
 const {checkedHeroImage}=await import('./studio-images');
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:404}));
 assert.match(await checkedHeroImage('https://images.unsplash.com/missing','Pool service'),/1576013551627/);
 assert.match(await checkedHeroImage('https://localhost/private','Handyman'),/1600596542815/);
});

import {assertReviewReady,shortSiteId} from './studio-domain';
const sections=['services','reviews','process','faq','contact'].map((kind,i)=>({id:kind,kind,title:kind+' section',purpose:'A useful visitor outcome',requirements:'Detailed original content and working visitor interactions',referenceUrls:[examples[i].websiteUrl],imageBrief:''}));
function reviewedDraft(){return {examples,blueprint:{summary:'A complete competitor informed website experience',visualDirection:'An editorial, elegant and accessible local website',competitors:examples.map(e=>({websiteUrl:e.websiteUrl,accessible:true,observations:'Observed the real competitor website content',patterns:['Clear service navigation']})),sections},content:{sections},review:{summary:'Compared actual desktop and mobile pages with competitors.',scores:{design:90,content:90,ux:90},comparisons:examples.map(e=>({websiteUrl:e.websiteUrl,observed:true,strengthsMatched:['Clear navigation'],remainingGaps:[]})),sectionChecks:sections.map(s=>({id:s.id,passed:true,notes:'Rendered and checked'})),changes:['Expanded the page'],blockers:[],ready:true},reviewChecks:{passed:true}};}
test('publication rejects missing sections, reordered content, failed browser checks and unresolved comparison gaps',()=>{
 const draft=reviewedDraft();assert.doesNotThrow(()=>assertReviewReady(draft));
 assert.throws(()=>assertReviewReady({...draft,content:{sections:sections.slice(1)}}),/section order/);
 assert.throws(()=>assertReviewReady({...draft,content:{sections:[...sections].reverse()}}),/section order/);
 assert.throws(()=>assertReviewReady({...draft,reviewChecks:{passed:false}}),/browser checks/);
 assert.throws(()=>assertReviewReady({...draft,review:{...draft.review,scores:{design:84,content:90,ux:90}}}),/unresolved gaps/);
 assert.throws(()=>assertReviewReady({...draft,review:{...draft.review,comparisons:draft.review.comparisons.map(v=>({...v,remainingGaps:['Missing competitor feature']}))}}),/unresolved gaps/);
 assert.throws(()=>assertReviewReady({...draft,review:{...draft.review,sectionChecks:draft.review.sectionChecks.map(v=>({...v,passed:false}))}}),/has not passed/);
 assert.throws(()=>assertReviewReady({...draft,review:{...draft.review,comparisons:[...draft.review.comparisons].reverse()}}),/sources/);
});
test('short URLs use cryptographically random six character IDs, independent of business name',()=>{const ids=Array.from({length:100},shortSiteId);assert.ok(ids.every(v=>/^[a-f0-9]{6}$/.test(v)));assert.equal(new Set(ids).size,ids.length);});

test('unavailable competitors remain honest evidence gaps, without invented visual patterns',()=>{
 const {blueprint}=reviewedDraft();blueprint.competitors[2]={...blueprint.competitors[2],accessible:false,patterns:[]};
 assert.doesNotThrow(()=>studioSchema.parse({blueprint}));
});

import {validateSectionContent} from './studio-domain';
test('section validation prevents decorative empty FAQs, missing images and plan mismatches',()=>{
 const draft:any=reviewedDraft();draft.content={headline:'Pool care in Phoenix',intro:'Original and useful introduction.',imageUrl:'https://example.com/hero.webp',services:[{title:'Pool cleaning',description:'Contact us for pool care.'}],about:'A local pool cleaning business.',cta:'Get in touch',assets:[],sections:sections.map(s=>({id:s.id,kind:s.kind,title:s.title,eyebrow:'',body:'A useful section.',items:Array.from({length:3},()=>({title:'Useful visitor question',body:'An original, factual answer.'})),imageIndex:null}))};
 assert.doesNotThrow(()=>validateSectionContent(draft));
 draft.content.sections[0].imageIndex=0;assert.throws(()=>validateSectionContent(draft),/missing image/);draft.content.sections[0].imageIndex=null;
 draft.content.sections.find((s:any)=>s.kind==='faq').items=[];assert.throws(()=>validateSectionContent(draft),/at least three/);
});

import {alignBlueprintSources} from './studio-domain';
test('research URLs align by business host despite redirects, order and trailing slashes',()=>{
 const {blueprint}=reviewedDraft();const shuffled={...blueprint,competitors:[...blueprint.competitors].reverse().map(c=>({...c,websiteUrl:c.websiteUrl+'/'}))};
 assert.deepEqual(alignBlueprintSources(shuffled as any,examples).competitors.map(c=>c.websiteUrl),examples.map(e=>e.websiteUrl));
 assert.throws(()=>alignBlueprintSources({...blueprint,competitors:blueprint.competitors.map(c=>({...c,websiteUrl:'https://unselected.com'}))} as any,examples),/exactly once/);
});

test('section evidence cannot cite an inaccessible competitor',()=>{
 const {blueprint}=reviewedDraft();blueprint.competitors[0].accessible=false;
 assert.throws(()=>alignBlueprintSources(blueprint as any,examples),/inaccessible/);
});
test('server asset binding preserves valid sections and removes references to nonexistent model images',()=>{
 const {bindContentAssets}=require('./studio-domain');
 const assets=[{url:'https://images.example/hero.webp',caption:'Illustrative hero',provenance:'generated',sourceUrl:''},{url:'https://images.example/detail.webp',caption:'Illustrative detail',provenance:'generated',sourceUrl:''}];
 const content={headline:'Home repairs in Phoenix',intro:'Discuss your home repair needs.',imageUrl:'https://example.com/placeholder',services:[{title:'Home repairs',description:'Discuss the repairs you need.'}],about:'Local home repair services.',cta:'Call us',sections:[{id:'about',kind:'about',title:'About us',eyebrow:'',body:'Local home repair services.',items:[],imageIndex:2},{id:'services',kind:'services',title:'Services',eyebrow:'',body:'Home repairs.',items:[],imageIndex:1}]};
 const bound=bindContentAssets(content,assets);assert.equal(bound.sections[0].imageIndex,null);assert.equal(bound.sections[1].imageIndex,1);assert.equal(bound.imageUrl,assets[0].url);assert.deepEqual(bound.assets,assets);assert.equal(content.sections[0].imageIndex,2);
});
test('honest business differences do not require invented reviews, credentials or features',()=>{
 const draft:any=reviewedDraft();
 draft.review.factualIssues=[];
 draft.review.comparisons[0].nonBlockingDifferences=[{detail:'Verified customer testimonials are not supplied',reason:'unavailable_business_asset',rationale:'The supplied business has no verified review quotes. The site links to its actual business profile instead.'},{detail:'Competitor financing and memberships',reason:'outside_supported_scope',rationale:'This website offers direct telephone inquiries; financing and membership products are not part of the supplied business facts.'}];
 assert.doesNotThrow(()=>assertReviewReady(draft));
 draft.review.comparisons[0].remainingGaps=['The supplied telephone number is not reachable from the primary CTA'];
 assert.throws(()=>assertReviewReady(draft),/unresolved gaps/);
});
test('a passing model verdict cannot override a factual issue or fabricated business claim',()=>{
 const draft:any=reviewedDraft();draft.review.factualIssues=['The FAQ promises same-day service without supporting business facts'];
 assert.throws(()=>assertReviewReady(draft),/Unsupported business claims/);
 draft.review.factualIssues=[];draft.review.scores.content=84;
 assert.throws(()=>assertReviewReady(draft),/unresolved gaps/);
});
