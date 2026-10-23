const { lookup } = require('node:dns/promises');
const { isIP } = require('node:net');
const { chromium } = require('playwright');
function publicAddress(ip) {
  if (isIP(ip) !== 4) return false; // Deliberately fail closed for IPv6/private mapped addresses.
  const [a,b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
}
async function publicUrl(value) {
  const u = new URL(value);
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || (u.port && !['80','443'].includes(u.port))) throw Error('Reference URL must be a public HTTP(S) website.');
  const addresses = await lookup(u.hostname, {all:true,family:4});
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw Error('Private network reference blocked.');
  return u.href;
}
// Pin each connection to a validated public IPv4 address; redirects pass through this gate again.
async function readPublic(value) {
  const u=new URL(await publicUrl(value));
  const addresses=await lookup(u.hostname,{all:true,family:4});
  if(addresses.some(a=>!publicAddress(a.address)))throw Error('Private network target blocked');
  const transport=require(u.protocol==='https:'?'node:https':'node:http');
  return new Promise((resolve,reject)=>{
    const req=transport.get(u,{headers:{'User-Agent':'Mozilla/5.0 DaniBoyReferencePreview/1.0','Accept':'*/*'},lookup:(_host,options,cb)=>options.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,4)},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>5000000){res.destroy();reject(Error('Reference resource exceeds 5MB'));}else chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).filter(([k])=>!['transfer-encoding','content-length','connection','set-cookie'].includes(k)).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):String(v)])),body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });
    req.setTimeout(15000,()=>req.destroy(Error('Reference request timed out')));req.on('error',reject);
  });
}
async function launch() { return chromium.launch({headless:true, ...(process.env.GENERATOR_CHROME_PATH ? {executablePath:process.env.GENERATOR_CHROME_PATH} : {})}); }
async function inspectReferences(snapshot, save) {
  const browser = await launch();
  const refs = [];
  try {
    for (let i = 0; i < snapshot.competitors.length; i++) {
      const example = snapshot.competitors[i];
      await publicUrl(example.websiteUrl);
      const context = await browser.newContext({viewport:{width:1280,height:900}, serviceWorkers:'block', acceptDownloads:false});
      let requests=0, bytes=0;
      await context.route('**/*', async route => {
        try {
          if (++requests>250 || bytes>30000000 || route.request().method() !== 'GET') return await route.abort();
          const response = await readPublic(route.request().url());
          bytes+=response.body.length;
          await route.fulfill(response);
        } catch { await route.abort(); }
      });
      await context.routeWebSocket('**/*', ws => ws.close());
      try {
        const page = await context.newPage();
        const response = await page.goto(example.websiteUrl, {waitUntil:'domcontentloaded', timeout:30000});
        if (!response?.ok()) throw Error(`HTTP ${response?.status() || 'unavailable'}`);
        await page.waitForTimeout(1200);
        const analysis = await page.evaluate(() => {
          const text = document.body.innerText.slice(0,10000);
          const samples = [...document.querySelectorAll('h1,h2,h3,p,a,button,section,header')].slice(0,70).map(el => {
            const s = getComputedStyle(el);
            return {tag:el.tagName,text:el.textContent.trim().slice(0,180),font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,color:s.color,background:s.backgroundColor,padding:s.padding,borderRadius:s.borderRadius};
          });
          return {title:document.title,text,samples};
        });
        if (analysis.text.length < 200 || /verify you are human|just a moment|access denied/i.test(analysis.title)) throw Error('Reference is blocked or has too little readable content');
        const screenshot = (await page.screenshot({type:'jpeg',quality:65})).toString('base64');
        const result = {url:page.url(),analysis,screenshot,observedAt:new Date().toISOString()};
        if (Buffer.byteLength(JSON.stringify(result)) > 800000) throw Error('Reference screenshot too large');
        await save(i, result);
        refs.push(result);
      } catch (e) { throw Error(`Cannot inspect example ${i+1} (${example.websiteUrl}): ${e.message}. Replace or repair this example and retry.`); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  return refs;
}
async function validateRendered(html) {
  const browser = await launch(), errors = [], screenshots = [];
  try {
    for (const width of [375,1440]) {
      const context = await browser.newContext({viewport:{width,height:900}, javaScriptEnabled:false,serviceWorkers:'block'});
      await context.route('**/*', r => r.abort());
      const page = await context.newPage();
      await page.setContent(html, {waitUntil:'load'});
      const result = await page.evaluate(() => ({overflow:document.documentElement.scrollWidth > innerWidth + 1, height:document.body.scrollHeight, links:[...document.querySelectorAll('a')].filter(a => a.getBoundingClientRect().width > 0).length}));
      if (result.overflow) errors.push(`Horizontal overflow at ${width}px`);
      if (result.height < 700 || result.links < 2) errors.push(`Incomplete landing page at ${width}px`);
      screenshots.push({width,image:(await page.screenshot({type:'jpeg',quality:60})).toString('base64')});
      await context.close();
    }
  } finally { await browser.close(); }
  return {errors,screenshots};
}
module.exports = {publicAddress,publicUrl,readPublic,inspectReferences,validateRendered};
