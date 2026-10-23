import {createHash} from 'node:crypto';
export function facts(lead:any){return {businessName:lead.businessName,service:lead.service,location:lead.location,phone:lead.phone,address:lead.profile?.address||'',email:lead.profile?.publicEmail||'',services:lead.profile?.services||[],hours:lead.profile?.openingHours||'',reviews:lead.profile?.reviews||[],rating:lead.profile?.rating??null,reviewCount:lead.profile?.reviewCount??null,googleMapsUrl:lead.profile?.googleMapsUrl||'',socialLinks:(lead.profile?.onlinePresence||[]).filter((v:any)=>v.status==='Found'&&v.url).map((v:any)=>({platform:v.platform,url:v.url}))};}

export function factsFingerprint(business:any){return createHash('sha256').update(JSON.stringify(business)).digest('hex');}
