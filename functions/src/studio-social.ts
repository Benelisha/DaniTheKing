type Response={status:number;headers:Record<string,string>;body:Buffer};
type Reader=(url:string)=>Promise<Response>;
const decode=(v:string)=>v.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:x([\da-f]+)|(\d+));/gi,(_,hex,decimal)=>String.fromCodePoint(parseInt(hex||decimal,hex?16:10)));
export function socialImageCandidates(html:string,base:string){
 const urls:string[]=[];
 for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){
  const attrs:Record<string,string>={};
  for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[match[1].toLowerCase()]=decode(match[2]??match[3]);
  if(['og:image','og:image:url','twitter:image','twitter:image:src'].includes((attrs.property||attrs.name||'').toLowerCase())&&attrs.content)urls.push(attrs.content);
 }
 // Public Instagram page data may expose post photos even when no post links render.
 for(const match of html.matchAll(/"(?:display_url|display_src)"\s*:\s*"((?:\\.|[^"\\])*)"/g))try{urls.push(JSON.parse('"'+match[1]+'"'));}catch{}
 return [...new Set(urls.map(v=>{try{const u=new URL(v,base);return u.protocol==='https:'?u.href:'';}catch{return '';}}).filter(Boolean))].slice(0,8);
}
export async function discoverSocialPhotos(links:{url:string;platform:string}[],reader?:Reader){
 // Reuse the worker's DNS-pinned public transport; every redirect and CDN URL is checked.
 const read:Reader=reader||require('../studio-runtime/worker/browser.cjs').readPublic;
 async function load(url:string,remaining=3):Promise<Response>{const r=await read(url);if(r.status>=300&&r.status<400&&r.headers.location&&remaining)return load(new URL(r.headers.location,url).href,remaining-1);if(r.status!==200)throw Error('Public photo unavailable');return r;}
 const photos:{data:Buffer;sourceUrl:string;imageUrl:string;platform:string}[]=[],seen=new Set<string>();
 for(const link of links.slice(0,4)){
  try{
   const page=await load(link.url);if(!/text\/html/i.test(page.headers['content-type']||''))continue;
   const html=page.body.toString('utf8');
   if(/<title[^>]*>[^<]*(?:log in|login|access denied|just a moment)/i.test(html))continue;
   for(const imageUrl of socialImageCandidates(html,link.url)){
    if(seen.has(imageUrl))continue;seen.add(imageUrl);
    try{const r=await load(imageUrl);if(!/^image\/(?:jpeg|png|webp)\b/i.test(r.headers['content-type']||''))continue;const meta=await (await import('sharp')).default(r.body,{limitInputPixels:25000000}).metadata();if((meta.width||0)<600||(meta.height||0)<300)continue;photos.push({data:r.body,sourceUrl:link.url,imageUrl,platform:link.platform});if(photos.length===2)return photos;}catch{}
   }
  }catch{/* Public social profiles can require login; retain the bank/generation fallback. */}
 }
 return photos;
}
