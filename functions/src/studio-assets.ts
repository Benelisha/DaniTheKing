import {getStorage} from 'firebase-admin/storage';
import {randomUUID} from 'node:crypto';
import {db} from './store';
import {gemini,managedSettings} from './gemini';
import {saveMedia} from './media';

// Only selected bank assets are exposed; arbitrary URLs are never fetched by the server.
export async function studioAssets(leadId:string,business:any,blueprint:any,actor:string){
 const bank=await db().collection(`leads/${leadId}/media`).get();
 const selected=bank.docs.map(d=>({...d.data(),id:d.id} as any)).filter(v=>v.selected!==false);
 const assets=[];
 for(let i=0;i<2;i++){
  let media=selected[i];
  if(!media){
   const config=await managedSettings();
   const response=await gemini(`Create an elegant editorial photograph for a ${business.service} website in ${business.location}. ${i?'Service detail, materials and texture':'Wide aspirational hero, calm composition with space for headline'}. Visual direction: ${blueprint.visualDirection}. No text, logos, watermarks or identifiable people. Illustrative concept only; never imply an actual customer project.`,config,'image');
   const image=response.images[0];if(!image||!['image/png','image/jpeg','image/webp'].includes(image.mimeType))throw Error('Image generation returned no usable image. Retry content generation.');
   media=await saveMedia(leadId,Buffer.from(image.data,'base64'),actor,i?'Illustrative service detail':'Illustrative hero image','generated');
  }
  const existing=await db().collection('websiteAssets').where('leadId','==',leadId).where('mediaId','==',media.id).limit(1).get();
  const assetId=existing.docs[0]?.id||randomUUID();
  if(existing.empty)await db().doc(`websiteAssets/${assetId}`).set({leadId,mediaId:media.id,path:media.path,caption:media.caption||'Business website image',provenance:media.provenance||'bank'});
  assets.push({url:`https://daniboy-be1c0.web.app/api/public/sites/images/${assetId}`,caption:media.caption||'Business website image',provenance:media.provenance==='generated'?'generated' as const:'bank' as const,sourceUrl:''});
 }
 return assets;
}
