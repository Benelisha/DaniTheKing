const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.STUDIO_HOSTED==='true'?'playwright-core':'playwright');
const {publicUrl,readPublic}=require('./browser.cjs');
async function publicURL(raw){try{if(new URL(raw).protocol!=='https:')return false;await publicUrl(raw);return true;}catch{return false;}}
function hostedBrowserArgs(args){return args.filter(arg=>arg!=='--single-process');}
async function openBrowser(){if(process.env.STUDIO_HOSTED==='true'){const module=require('@sparticuz/chromium'),binary=module.default||module;await module.inflate(path.join(path.dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'));module.setupLambdaEnvironment(path.join(require('node:os').tmpdir(),'al2023/lib'));return chromium.launch({headless:true,args:hostedBrowserArgs(binary.args),executablePath:await binary.executablePath()});}return chromium.launch({headless:true});}
async function references(browser,examples,dir){
 const result=[];const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false});
 context.setDefaultTimeout(15000);let requests=0,bytes=0;
 await context.route('**/*',async route=>{try{if(++requests>1250||bytes>150000000||route.request().method()!=='GET')return await route.abort();const response=await readPublic(route.request().url());bytes+=response.body.length;await route.fulfill(response);}catch{await route.abort();}});
 await context.routeWebSocket('**/*',ws=>ws.close());
 for(let i=0;i<examples.length;i++){
  const page=await context.newPage(),entry={websiteUrl:examples[i].websiteUrl,observed:false};
  try{await page.goto(entry.websiteUrl,{waitUntil:'domcontentloaded',timeout:35000});await page.waitForTimeout(2500);entry.title=await page.title();entry.text=(await page.locator('body').innerText()).slice(0,22000);entry.observed=entry.text.length>250&&!/just a moment|verify you are human|access denied/i.test(entry.title);if(entry.observed){entry.visualEvidence=await page.evaluate(collectVisualEvidence);entry.screenshot=path.join(dir,`competitor-${i+1}.png`);await page.screenshot({path:entry.screenshot,fullPage:false,timeout:20000});}}catch(e){entry.error=e.message.slice(0,200);entry.observed=false;delete entry.screenshot;}finally{await page.close();}
  result.push(entry);
 }
 await context.close();await fs.writeFile(path.join(dir,'competitors.json'),JSON.stringify(result,null,2));return result;
}
// Runs in the competitor page; retain only visible, opaque computed colors.
function collectVisualEvidence(){
 const colors=new Map(),fonts=new Set(),radii=new Set(),spacing=new Set();
 const hex=value=>{const m=value.match(/^rgba?\(([^)]+)\)$/);if(!m)return null;const parts=m[1].split(',').map(Number);if(parts.length===4&&parts[3]!==1)return null;return '#'+parts.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');};
 for(const el of Array.from(document.querySelectorAll('body,body *')).slice(0,12000)){
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(!r.width||!r.height||s.visibility==='hidden'||s.display==='none')continue;
  for(const property of ['color','backgroundColor',...(parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=='none'?['borderTopColor']:[])]){const value=hex(s[property]);if(value)colors.set(value,(colors.get(value)||0)+1);}
  fonts.add(s.fontFamily);radii.add(s.borderRadius);spacing.add(s.padding);
 }
 return {colors:[...colors].sort((a,b)=>b[1]-a[1]).slice(0,80).map(([color])=>color),fonts:[...fonts].slice(0,20),cornerRadii:[...radii].slice(0,25),padding:[...spacing].slice(0,40),headings:Array.from(document.querySelectorAll('h1,h2,h3,nav a,button')).slice(0,100).map(el=>({text:el.textContent?.trim().slice(0,150),fontSize:getComputedStyle(el).fontSize,fontWeight:getComputedStyle(el).fontWeight}))};
}
// Solve the six renderer contrast constraints using observed colors only.
// Keep a valid model palette unchanged; otherwise minimize RGB distance to its choices.
function accessiblePalette(design,colors){
 const pairs=[['onInk','ink'],['ink','background'],['ink','surface'],['onAccent','accent'],['accent','background'],['accent','surface']];
 if(pairs.every(([a,b])=>contrast(design[a],design[b])>=4.5))return design;
 const rgb=h=>h.slice(1).match(/../g).map(v=>parseInt(v,16));
 const cost=Object.fromEntries(['ink','accent','background','surface','onInk','onAccent'].map(token=>{
  const target=rgb(design[token]);return [token,colors.map(c=>rgb(c).reduce((sum,v,i)=>sum+(v-target[i])**2,0))];
 }));
 const ratios=colors.map(a=>colors.map(b=>contrast(a,b)));
 const closest=(token,indices)=>indices.reduce((best,i)=>best<0||cost[token][i]<cost[token][best]?i:best,-1);
 const partners=colors.map((_,i)=>colors.map((_,j)=>j).filter(j=>ratios[i][j]>=4.5));
 const onInk=partners.map(indices=>closest('onInk',indices)),onAccent=partners.map(indices=>closest('onAccent',indices));
 let best=null,bestCost=Infinity;
 for(let ink=0;ink<colors.length;ink++){
  if(onInk[ink]<0)continue;
  for(let accent=0;accent<colors.length;accent++){
   if(onAccent[accent]<0)continue;
   const common=partners[ink].filter(i=>ratios[accent][i]>=4.5);if(!common.length)continue;
   const background=closest('background',common),surface=closest('surface',common);
   const choice={ink,accent,background,surface,onInk:onInk[ink],onAccent:onAccent[accent]};
   const score=Object.entries(choice).reduce((sum,[token,i])=>sum+cost[token][i]*(token==='accent'?3:token==='ink'?2:1),0);
   if(score<bestCost){bestCost=score;best=choice;}
  }
 }
 if(!best)throw Error('Observed competitor colors cannot satisfy the renderer contrast requirements. Choose different references.');
 return {...design,...Object.fromEntries(Object.entries(best).map(([token,i])=>[token,colors[i]])),rationale:(design.rationale||'')+' Foreground/background assignments were adjusted within the observed palette to meet all six 4.5:1 contrast checks.'};
}
function bindPalette(design,refs){
 const sources=refs.filter(r=>r.observed&&r.visualEvidence?.colors?.length).map(r=>({websiteUrl:r.websiteUrl,colors:r.visualEvidence.colors}));
 if(!sources.length)throw Error('No observed competitor palette available. Retry competitor inspection; colors will not be invented.');
 const allowed=new Set(sources.flatMap(s=>s.colors.map(c=>c.toLowerCase())));
 for(const token of ['accent','background','ink','surface','onAccent','onInk'])if(!design[token]||!allowed.has(design[token].toLowerCase()))throw Error(`Unsourced palette color: ${token}. Use only observed competitor colors.`);
 design=accessiblePalette(design,[...allowed]);
 return {...design,paletteSources:sources.map(s=>({...s,colors:s.colors.filter(c=>['accent','background','ink','surface','onAccent','onInk'].some(k=>design[k].toLowerCase()===c.toLowerCase()))})).filter(s=>s.colors.length)};
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
  const contact=page.locator('#contact');let contactPassed=await contact.count()>0;
  const primary=page.getByRole('button',{name:site.content.cta+' ↗',exact:true}).first();
  if(await primary.count()){await primary.click();try{await page.waitForFunction(()=>{const el=document.getElementById('contact');if(!el)return false;const r=el.getBoundingClientRect();return r.top<window.innerHeight&&r.bottom>0;},null,{timeout:5000});}catch{contactPassed=false;}}else contactPassed=false;
  const serviceButtons=page.getByRole('button',{name:site.content.services[0]?.title,exact:true});let serviceSelectionPassed=false;
  if(await serviceButtons.count()){await serviceButtons.first().click();try{await page.waitForFunction(service=>document.getElementById('contact')?.textContent.includes('Let’s discuss '+service),site.content.services[0].title,{timeout:3000});serviceSelectionPassed=true;}catch{serviceSelectionPassed=false;}}
  const contactLayoutPassed=await page.evaluate(()=>{
   const inquiry=document.querySelector('[id$="-inquiry"]'),details=document.querySelector('[id$="-details"]');
   if(!inquiry||!details)return false;const a=inquiry.getBoundingClientRect(),b=details.getBoundingClientRect();
   return a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;
  });
  const missingSections=(site.blueprint?.sections||[]).filter(s=>!measured.sections.includes(s.id)).map(s=>s.id);
  await page.locator('#hero').evaluate(el=>el.scrollIntoView());
  // Expand scroll ancestors only for a full-length artifact, after measuring real viewport layout.
  await page.evaluate(()=>{let el=document.getElementById('site-content')?.parentElement;while(el){el.style.overflow='visible';el.style.height='auto';el.style.maxHeight='none';el=el.parentElement;}});
  const screenshot=path.join(dir,`${label}-${name}.png`);await page.screenshot({path:screenshot,fullPage:true,timeout:30000});screens.push(screenshot);
  checks.push({viewport:name,width,brokenImages:measured.brokenImages,overflow:measured.overflow,errors,faqPassed,contactPassed,serviceSelectionPassed,contactLayoutPassed,missingSections,headings:measured.headings,sections:measured.sections,text:measured.text?.slice(0,25000),passed:!errors.length&&!measured.brokenImages&&!measured.overflow&&faqPassed&&contactPassed&&serviceSelectionPassed&&contactLayoutPassed&&!missingSections.length});await context.close();
 }}finally{await new Promise(r=>server.close(r));}
 const d=site.design,surface=d.surface||'#ffffff';const colors={onInk:contrast(d.onInk||'#ffffff',d.ink),inkBackground:contrast(d.ink,d.background),inkSurface:contrast(d.ink,surface),onAccent:contrast(d.onAccent||'#ffffff',d.accent),accentBackground:contrast(d.accent,d.background),accentSurface:contrast(d.accent,surface)};
 const result={passed:checks.every(c=>c.passed)&&Object.values(colors).every(v=>v>=4.5),colors,viewports:checks};await fs.writeFile(path.join(dir,`${label}-checks.json`),JSON.stringify(result,null,2));return {checks:result,screens};
}
module.exports={references,capture,openBrowser,contrast,publicURL,hostedBrowserArgs,collectVisualEvidence,bindPalette};
