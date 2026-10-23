// The browser owns this sequence; the server still owns each individual job.
export const generationStages=['examples','blueprint','brief','content','design','review'] as const;
export async function generateAll(options:{initial:any;read:()=>Promise<any>;generate:(stage:string,revision:number)=>Promise<any>;active:()=>boolean;update:(state:any,stage:string)=>void;wait:()=>Promise<void>}){
 let state=options.initial;
 const start=state.invalidExamples?0:generationStages.findIndex(stage=>!state.draft?.[stage]||(stage==='review'&&(!state.draft.review.ready||!state.draft.reviewChecks?.passed)));
 if(start<0)return state;
 for(const stage of generationStages.slice(start)){
  if(!options.active())return state;
  state=await options.generate(stage,state.revision);
  if(!options.active())return state;
  options.update(state,stage);
  const jobId=state.jobId;
  while(!['completed','failed','cancelled'].includes(state.job?.status)){
   await options.wait();if(!options.active())return state;
   state=await options.read();if(!options.active())return state;
   if(state.jobId!==jobId)throw Error('Generation changed in another window. Generate all stopped.');
   options.update(state,stage);
  }
  if(state.job.status!=='completed')throw Error(`${stage}: ${state.job.error||'Generation was cancelled.'}`);
  if(stage==='review'&&(!state.draft.review?.ready||!state.draft.reviewChecks?.passed))throw Error('All steps finished. Quality review needs attention; inspect the report before publishing.');
 }
 return state;
}
