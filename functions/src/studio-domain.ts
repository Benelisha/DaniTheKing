import {z} from 'zod';
import {randomBytes} from 'node:crypto';
export const exampleSchema=z.object({businessName:z.string().min(2),websiteUrl:z.url().refine(v=>new URL(v).protocol==='https:'),notes:z.string().min(10)});
export const examplesSchema=z.array(exampleSchema).length(5).refine(rows=>new Set(rows.map(r=>new URL(r.websiteUrl).hostname.replace(/^www\./,''))).size===5,'Use five distinct websites');
export const analysisSchema=z.array(z.object({websiteUrl:z.url(),good:z.array(z.string().min(5)).length(5),bad:z.array(z.string().min(5)).length(5)})).length(5);
export const briefSchema=z.object({direction:z.string().min(10).max(3000),audience:z.string().min(3).max(500),sections:z.string().min(5).max(1500),features:z.array(z.enum(['contact','newsletter','appointment'])).default(['contact'])});
export const sectionKind=z.enum(['services','about','process','reviews','gallery','faq','areas','cta','contact']);
export const blueprintSchema=z.object({summary:z.string().min(30),visualDirection:z.string().min(30),competitors:z.array(z.object({websiteUrl:z.url(),accessible:z.boolean(),observations:z.string().min(20),patterns:z.array(z.string())})).length(5),sections:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9-]*$/),kind:sectionKind,title:z.string().min(3),purpose:z.string().min(10),requirements:z.string().min(10),referenceUrls:z.array(z.url()).min(1),imageBrief:z.string()})).min(2).max(12)}).refine(v=>new Set(v.sections.map(s=>s.id)).size===v.sections.length,'Section IDs must be unique');
export const pageSectionSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9-]*$/),kind:sectionKind,title:z.string().min(3),eyebrow:z.string(),body:z.string(),items:z.array(z.object({title:z.string(),body:z.string()})).max(12),imageIndex:z.number().int().min(0).max(9).nullable()});
export const assetSchema=z.object({url:z.url(),caption:z.string(),provenance:z.enum(['uploaded','bank','social','generated','illustrative']),sourceUrl:z.string()});
export const contentSchema=z.object({headline:z.string().min(5).max(200),intro:z.string().min(10).max(2000),imageUrl:z.string().url().refine(v=>new URL(v).protocol==='https:'),services:z.array(z.object({title:z.string().min(2),description:z.string().min(5)})).min(1).max(12),about:z.string().min(10).max(3000),cta:z.string().min(3).max(80),sections:z.array(pageSectionSchema).max(12).optional(),assets:z.array(assetSchema).max(10).optional()});
const hexColor=z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const designSchema=z.object({surface:hexColor.optional(),onAccent:hexColor.optional(),onInk:hexColor.optional(),paletteSources:z.array(z.object({websiteUrl:z.url(),colors:z.array(hexColor)})).optional(),accent:z.string().regex(/^#[a-fA-F0-9]{6}$/),background:z.string().regex(/^#[a-fA-F0-9]{6}$/),ink:z.string().regex(/^#[a-fA-F0-9]{6}$/),heroLayout:z.enum(['split','centered']),visualStyle:z.enum(['editorial','bold','minimal']).optional(),serviceLayout:z.enum(['cards','list']).optional(),imageShape:z.enum(['rounded','arch']).optional(),cornerRadius:z.number().min(0).max(32),rationale:z.string().min(20).max(3000),fontStyle:z.enum(['modern','editorial']).optional()});
export const reviewSchema=z.object({summary:z.string().min(20),scores:z.object({design:z.number().min(0).max(100),content:z.number().min(0).max(100),ux:z.number().min(0).max(100)}),comparisons:z.array(z.object({websiteUrl:z.url(),observed:z.boolean(),strengthsMatched:z.array(z.string()),remainingGaps:z.array(z.string())})).length(5),sectionChecks:z.array(z.object({id:z.string(),passed:z.boolean(),notes:z.string()})).min(2),changes:z.array(z.string()),blockers:z.array(z.string()),ready:z.boolean()});
export function validateSectionContent(draft:any){
 const plan=blueprintSchema.parse(draft.blueprint),content=contentSchema.parse(draft.content);
 if(JSON.stringify(content.sections?.map(s=>[s.id,s.kind]))!==JSON.stringify(plan.sections.map(s=>[s.id,s.kind])))throw Error('Content must preserve blueprint section order and types.');
 for(const section of content.sections!){
  if(['faq','process'].includes(section.kind)&&section.items.length<3)throw Error(`${section.kind} requires at least three useful items.`);
  if(section.kind==='services'&&!section.items.length)throw Error('Service details are required.');
  if(section.imageIndex!=null&&section.imageIndex>=(content.assets?.length||0))throw Error('Section references a missing image.');
 }
}
export function assertReviewReady(draft:any){
 blueprintSchema.parse(draft.blueprint);const review=reviewSchema.parse(draft.review);
 const sections=draft.content?.sections||[];
 if(JSON.stringify(review.comparisons.map(v=>v.websiteUrl))!==JSON.stringify(draft.examples.map((v:any)=>v.websiteUrl)))throw Error('Review sources must match the selected examples.');
 if(JSON.stringify(sections.map((v:any)=>v.id))!==JSON.stringify(draft.blueprint.sections.map((v:any)=>v.id)))throw Error('Content must preserve blueprint section order.');
 if(!review.ready||review.blockers.length||Object.values(review.scores).some(v=>v<85)||review.comparisons.filter(v=>v.observed).length<3||review.comparisons.some(v=>v.observed&&v.remainingGaps.length>0))throw Error('Comparison review has unresolved gaps. Run Compare & improve before publishing.');
 for(const s of draft.blueprint.sections){if(!sections.some((v:any)=>v.id===s.id&&v.kind===s.kind)||!review.sectionChecks.some(v=>v.id===s.id&&v.passed))throw Error(`Section ${s.id} has not passed review.`);}
 if(!draft.reviewChecks?.passed)throw Error('Desktop and mobile browser checks must pass before publishing.');
}
export function shortSiteId(){return randomBytes(3).toString('hex');}
export const studioSchema=z.object({examples:examplesSchema.optional(),analysis:analysisSchema.optional(),blueprint:blueprintSchema.optional(),brief:briefSchema.optional(),content:contentSchema.optional(),design:designSchema.optional()});
export const stageSchema=z.enum(['examples','analysis','blueprint','brief','content','design','review']);
export function businessSlug(name:string,id:string){return (name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'business')+'-'+id.slice(0,6);}
export function validateStage(stage:string,draft:any){
  if(stage!=='examples')examplesSchema.parse(draft.examples);
  if(['brief','content','design','review','publish'].includes(stage))blueprintSchema.parse(draft.blueprint);
  if(['content','design','review','publish'].includes(stage))briefSchema.parse(draft.brief);
  if(['design','review','publish'].includes(stage))contentSchema.parse(draft.content);
  if(['review','publish'].includes(stage))designSchema.parse(draft.design);
  if(stage==='publish'){validateSectionContent(draft);assertReviewReady(draft);}
}

export function alignBlueprintSources(blueprint:z.infer<typeof blueprintSchema>,examples:z.infer<typeof examplesSchema>){
 const host=(url:string)=>new URL(url).hostname.toLowerCase().replace(/^www\./,'');
 const competitors=alignWebsiteRows(blueprint.competitors,examples);
 const allowed=new Set(competitors.filter(c=>c.accessible).map(c=>host(c.websiteUrl)));
 for(const section of blueprint.sections)if(section.referenceUrls.some(url=>!allowed.has(host(url))))throw Error('Blueprint section cites an unselected or inaccessible competitor.');
 return {...blueprint,competitors};
}

export function alignWebsiteRows<T extends {websiteUrl:string}>(rows:T[],examples:{websiteUrl:string}[]):T[]{
 const host=(url:string)=>new URL(url).hostname.toLowerCase().replace(/^www\./,'');
 return examples.map(e=>{const matches=rows.filter(c=>host(c.websiteUrl)===host(e.websiteUrl));if(matches.length!==1)throw Error('Research must inspect each selected competitor exactly once.');return {...matches[0],websiteUrl:e.websiteUrl};});
}
