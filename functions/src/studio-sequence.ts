// Shared ordering only; the backend worker owns execution and advancement.
export const generationStages=['examples','blueprint','brief','content','design','review'] as const;
export const terminalRun=new Set(['completed','failed','cancelled','needs_review']);
export function remainingStages(state:any){
 const start=state.invalidExamples?0:generationStages.findIndex(stage=>!state.draft?.[stage]||(stage==='review'&&(!state.draft.review.ready||!state.draft.reviewChecks?.passed)));
 return start<0?[]:generationStages.slice(start);
}
// Stop at the first failed stage; successful outputs are persisted by each service.
export async function runStages(options:{stages:readonly string[];active:()=>Promise<boolean>;execute:(stage:string)=>Promise<void>}){
 for(const stage of options.stages){if(!await options.active())return false;await options.execute(stage);}
 return true;
}
