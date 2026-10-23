import {getStorage} from 'firebase-admin/storage';
import {randomUUID} from 'node:crypto';
import {db} from './store';
import {gemini,managedSettings} from './gemini';
import {saveMedia} from './media';
import {discoverSocialPhotos} from './studio-social';

// Only selected bank assets are exposed; arbitrary URLs are never fetched by the server.
export async function studioAssets(leadId:string,business:any,blueprint:any,actor:string){
 const bank=await db().collection(`leads/${leadId}/media`).get();
 const selected=bank.docs.map(d=>({...d.data(),id:d.id} as any)).filter(v=>v.selected!==false);
 const genuine=selected.filter(v=>v.provenance!=='generated');
 if(genuine.length<2&&business.socialLinks?.length){
  const photos=await discoverSocialPhotos(business.socialLinks);
  for(const photo of photos){
   if(genuine.length>=2)break;
   let media=selected.find(v=>v.sourceImageUrl===photo.imageUrl);
   if(!media){media=await saveMedia(leadId,photo.data,actor,`${business.businessName} · ${photo.platform}`,'social');await db().doc(`leads/${leadId}/media/${media.id}`).update({sourceUrl:photo.sourceUrl,sourceImageUrl:photo.imageUrl});media={...media,sourceUrl:photo.sourceUrl,sourceImageUrl:photo.imageUrl};}
   if(!genuine.some(v=>v.id===media.id))genuine.push(media);
  }
 }
 const preferred=[...genuine,...selected.filter(v=>v.provenance==='generated')];
 const assets=[];
 for(let i=0;i<2;i++){
  let media=preferred[i];
  if(!media){
   const config=await managedSettings();
   const response=await gemini(`Create an illustrative image for a ${business.service} website in ${business.location}, used as ${i?'a supporting section image':'the hero image'}. Match only the palette, photographic style, subject treatment, lighting and composition observed in the selected competitor references recorded below. Do not impose an editorial look, warm lighting, arch crop or other invented art direction. Competitor visual direction: ${blueprint.visualDirection}. Sourced image briefs: ${JSON.stringify(blueprint.sections?.map((section:any)=>({referenceUrls:section.referenceUrls,imageBrief:section.imageBrief}))||[])}. No text, logos, watermarks or identifiable people. Illustrative concept only; never imply an actual customer project.`,config,'image');
   const image=response.images[0];if(!image||!['image/png','image/jpeg','image/webp'].includes(image.mimeType))throw Error('Image generation returned no usable image. Retry content generation.');
   media=await saveMedia(leadId,Buffer.from(image.data,'base64'),actor,i?'Illustrative service detail':'Illustrative hero image','generated');
  }
  const existing=await db().collection('websiteAssets').where('leadId','==',leadId).where('mediaId','==',media.id).limit(1).get();
  const assetId=existing.docs[0]?.id||randomUUID();
  if(existing.empty)await db().doc(`websiteAssets/${assetId}`).set({leadId,mediaId:media.id,path:media.path,caption:media.caption||'Business website image',provenance:media.provenance||'bank',sourceUrl:media.sourceUrl||''});
  assets.push({url:`https://daniboy-be1c0.web.app/api/public/sites/images/${assetId}`,caption:media.caption||'Business website image',provenance:media.provenance==='generated'?'generated' as const:media.provenance==='social'?'social' as const:'bank' as const,sourceUrl:media.sourceUrl||''});
 }
 return assets;
}
