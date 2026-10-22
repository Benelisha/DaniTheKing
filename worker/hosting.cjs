const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const SITE = 'daniboy-be1c0-prospects';
const PROJECT = 'daniboy-be1c0';
const ORIGIN = 'https://firebasehosting.googleapis.com/v1beta1';
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; script-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
async function api(auth, path, method = 'GET', body) {
  const token = await auth.getAccessToken();
  const r = await fetch(`${ORIGIN}/${path}`, {method, headers:{Authorization:`Bearer ${token.token || token}`, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(30000)});
  if (!r.ok) throw Object.assign(Error(`Firebase Hosting ${method} failed (${r.status}). Check Hosting permissions and site setup.`),{status:r.status});
  return r.status === 204 ? {} : r.json();
}
async function ensureSite(auth) {
  try { await api(auth,`projects/${PROJECT}/sites/${SITE}`); }
  catch (e) { if (e.status !== 404) throw e; await api(auth,`projects/${PROJECT}/sites?siteId=${SITE}`,'POST',{}); }
}
async function liveManifest(auth) {
  const releases = await api(auth,`sites/${SITE}/releases?pageSize=1`);
  const previous = releases.releases?.[0]?.version?.name;
  const files = {};
  if (previous) {
    let pageToken = '';
    do {
      const page = await api(auth,`${previous}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const f of page.files || []) files[f.path] = f.hash;
      pageToken = page.nextPageToken || '';
    } while (pageToken);
  }
  return {previous,files};
}
async function publish(auth, leadId, artifact, jobId, checkpoint, assertLease) {
  if (!/^[a-f0-9]{32}$/.test(leadId)) throw Error('Invalid publication path');
  await assertLease();
  const {previous,files} = await liveManifest(auth);
  const compressed = gzipSync(artifact.html), hash = createHash('sha256').update(compressed).digest('hex');
  files[`/${leadId}/index.html`] = hash;
  const version = await api(auth,`sites/${SITE}/versions`,'POST',{config:{headers:[{glob:'**',headers:{'Content-Security-Policy':CSP,'X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-cache'}}]}});
  await checkpoint({hostingVersion:version.name,previousHostingVersion:previous || null});
  const populated = await api(auth,`${version.name}:populateFiles`,'POST',{files});
  for (const required of populated.uploadRequiredHashes || []) {
    if (required !== hash) throw Error('An existing site asset is unavailable. Publication stopped to preserve other sites.');
    const token = await auth.getAccessToken();
    const upload = new URL(`${populated.uploadUrl}/${hash}`);
    if (upload.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected Hosting upload origin');
    const r = await fetch(upload,{method:'POST',headers:{Authorization:`Bearer ${token.token || token}`,'Content-Type':'application/octet-stream'},body:compressed,signal:AbortSignal.timeout(30000)});
    if (!r.ok) throw Error(`Hosting upload failed (${r.status})`);
  }
  await api(auth,`${version.name}?updateMask=status`,'PATCH',{status:'FINALIZED'});
  await assertLease();
  await api(auth,`sites/${SITE}/releases?versionName=${encodeURIComponent(version.name)}`,'POST',{});
  const url = `https://${SITE}.web.app/${leadId}/`;
  let live = false;
  for (let attempt=0;attempt<5;attempt++) {
    await assertLease();
    try {
      const r = await fetch(`${url}?generation=${jobId}`,{signal:AbortSignal.timeout(15000),cache:'no-store'});
      const html = await r.text();
      live = r.ok && html.includes(`content="${jobId}"`) && html.includes('noindex');
      if (live) break;
    } catch {}
    await new Promise(r=>setTimeout(r,2000));
  }
  if (!live) {
    await assertLease();
    if (previous) await api(auth,`sites/${SITE}/releases?versionName=${encodeURIComponent(previous)}`,'POST',{});
    throw Error('Live publication check failed; previous release restored when available. Retry reuses the saved artifact.');
  }
  return url;
}
module.exports = {api,ensureSite,publish,liveManifest,SITE,PROJECT};
