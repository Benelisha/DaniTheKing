// Generated stock image identifiers are suggestions, never assumed to exist.
export async function checkedHeroImage(candidate:string,service:string){
  const fallback=/pool|spa/i.test(service)?'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=1600&q=85&fit=crop':'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1600&q=85&fit=crop';
  try{const u=new URL(candidate);if(u.origin!=='https://images.unsplash.com')return fallback;const r=await fetch(u,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(10000)});if(r.ok&&r.headers.get('content-type')?.startsWith('image/'))return candidate;}catch{}
  return fallback;
}
