import {z} from 'zod';
export const exampleSchema=z.object({businessName:z.string().min(2),websiteUrl:z.url().refine(v=>new URL(v).protocol==='https:'),notes:z.string().min(10)});
export const examplesSchema=z.array(exampleSchema).length(5).refine(rows=>new Set(rows.map(r=>new URL(r.websiteUrl).hostname.replace(/^www\./,''))).size===5,'Use five distinct websites');
export const analysisSchema=z.array(z.object({websiteUrl:z.url(),good:z.array(z.string().min(5)).length(5),bad:z.array(z.string().min(5)).length(5)})).length(5);
export const briefSchema=z.object({direction:z.string().min(10).max(3000),audience:z.string().min(3).max(500),sections:z.string().min(5).max(1500),features:z.array(z.enum(['contact','newsletter','appointment'])).default(['contact'])});
export const contentSchema=z.object({headline:z.string().min(5).max(200),intro:z.string().min(10).max(2000),imageUrl:z.string().url().refine(v=>new URL(v).protocol==='https:'),services:z.array(z.object({title:z.string().min(2),description:z.string().min(5)})).min(1).max(12),about:z.string().min(10).max(3000),cta:z.string().min(3).max(80)});
export const designSchema=z.object({accent:z.string().regex(/^#[a-fA-F0-9]{6}$/),background:z.string().regex(/^#[a-fA-F0-9]{6}$/),ink:z.string().regex(/^#[a-fA-F0-9]{6}$/),heroLayout:z.enum(['split','centered']),cornerRadius:z.number().min(0).max(32),rationale:z.string().min(20).max(3000)});
export const studioSchema=z.object({examples:examplesSchema.optional(),analysis:analysisSchema.optional(),brief:briefSchema.optional(),content:contentSchema.optional(),design:designSchema.optional()});
export const stageSchema=z.enum(['examples','analysis','brief','content','design']);
export function businessSlug(name:string,id:string){return (name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'business')+'-'+id.slice(0,6);}
export function validateStage(stage:string,draft:any){
  if(stage!=='examples')examplesSchema.parse(draft.examples);
  if(['content','design','publish'].includes(stage)){analysisSchema.parse(draft.analysis);briefSchema.parse(draft.brief);}
  if(['design','publish'].includes(stage))contentSchema.parse(draft.content);
  if(stage==='publish')designSchema.parse(draft.design);
}
