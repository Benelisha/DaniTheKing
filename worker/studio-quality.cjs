const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),dns=require('node:dns/promises');
const {chromium}=require('playwright');
function privateIP(ip){return /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::|f[cd]|fe80)/i.test(ip);}
async function publicURL(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port))return false;const records=await dns.lookup(u.hostname,{all:true});return records.length>0&&records.every(r=>!privateIP(r.address));}catch{return false;}}
async function openBrowser(){return chromium.launch({headless:true});}
async function references(browser,examples,dir){
 const result=[];const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const cache=new Map();await context.route('**/*',async route=>{const url=route.request().url();if(url.startsWith('data:'))return route.continue();const origin=(()=>{try{return new URL(url).origin;}catch{return '';}})();if(!cache.has(origin))cache.set(origin,await publicURL(url));return cache.get(origin)?route.continue():route.abort();});
 for(let i=0;i<examples.length;i++){
  const page=await context.newPage(),entry={websiteUrl:examples[i].websiteUrl,observed:false};
  try{await page.goto(entry.websiteUrl,{waitUntil:'domcontentloaded',timeout:35000});await page.waitForTimeout(2500);entry.title=await page.title();entry.text=(await page.locator('body').innerText()).slice(0,22000);entry.observed=entry.text.length>250&&!/just a moment|verify you are human|access denied/i.test(entry.title);if(entry.observed){entry.screenshot=path.join(dir,`competitor-${i+1}.png`);await page.screenshot({path:entry.screenshot,fullPage:false});}}catch(e){entry.error=e.message.slice(0,200);}finally{await page.close();}
  result.push(entry);
 }
 await context.close();await fs.writeFile(path.join(dir,'competitors.json'),JSON.stringify(result,null,2));return result;
}
function contrast(a,b){const lum=h=>{const v=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
async function capture(browser,site,dir,label='candidate'){
 const root=path.resolve(__dirname,'../websites/dist');
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),relative=decodeURIComponent(url.pathname).replace(/^\/+/,''),filename=path.resolve(root,relative||'index.html');if(!filename.startsWith(root+path.sep)&&filename!==path.join(root,'index.html')){res.writeHead(403).end();return;}let file=filename;try{if(!(await fs.stat(file)).isFile())file=path.join(root,'index.html');}catch{file=path.join(root,'index.html');}const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'}[ext]||'application/octet-stream'));res.end(await fs.readFile(file));}catch{res.writeHead(500).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,checks=[],screens=[];
 try{for(const [name,width] of [['desktop',1440],['mobile',390]]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://daniboy-be1c0.web.app/api/public/sites/qa',route=>route.fulfill({json:site,headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.goto(origin+'/qa',{waitUntil:'networkidle',timeout:60000});await page.locator('#site-content').waitFor();
  await page.evaluate(async()=>{await Promise.all(Array.from(document.images).map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=img.onerror=r;setTimeout(r,12000);})));});
  const measured=await page.evaluate(()=>({brokenImages:Array.from(document.images).filter(i=>!i.complete||!i.naturalWidth).length,overflow:Array.from(document.querySelectorAll('#site-content *')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left< -2||r.right>window.innerWidth+2);}).length,sections:Array.from(document.querySelectorAll('#site-content [id]')).map(e=>e.id),headings:Array.from(document.querySelectorAll('[role="heading"]')).map(e=>e.textContent),text:document.getElementById('site-content').textContent}));
  const faq=page.getByRole('button',{expanded:false}).first();let faqPassed=true;if(await faq.count()){await faq.click();faqPassed=await faq.getAttribute('aria-expanded')==='true';}
  const contact=page.locator('#contact');const contactPassed=await contact.count()>0;
  // Expand scroll ancestors only for a full-length artifact, after measuring real viewport layout.
  await page.evaluate(()=>{let el=document.getElementById('site-content')?.parentElement;while(el){el.style.overflow='visible';el.style.height='auto';el.style.maxHeight='none';el=el.parentElement;}});
  const screenshot=path.join(dir,`${label}-${name}.png`);await page.screenshot({path:screenshot,fullPage:true});screens.push(screenshot);
  checks.push({viewport:name,width,brokenImages:measured.brokenImages,overflow:measured.overflow,errors,faqPassed,contactPassed,headings:measured.headings,sections:measured.sections,text:measured.text?.slice(0,25000),passed:!errors.length&&!measured.brokenImages&&!measured.overflow&&faqPassed&&contactPassed});await context.close();
 }}finally{await new Promise(r=>server.close(r));}
 const colors={inkBackground:contrast(site.design.ink,site.design.background),whiteAccent:contrast('#ffffff',site.design.accent),accentBackground:contrast(site.design.accent,site.design.background)};
 const result={passed:checks.every(c=>c.passed)&&Object.values(colors).every(v=>v>=4.5),colors,viewports:checks};await fs.writeFile(path.join(dir,`${label}-checks.json`),JSON.stringify(result,null,2));return {checks:result,screens};
}
module.exports={references,capture,openBrowser,contrast,publicURL};
