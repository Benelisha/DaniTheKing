const test=require('node:test'),assert=require('node:assert/strict');
const {contrast,publicURL}=require('./studio-quality.cjs');
test('contrast measurement rejects weak generated colors',()=>{assert.equal(contrast('#ffffff','#000000'),21);assert.equal(contrast('#ffffff','#ffffff'),1);assert.ok(contrast('#ffffff','#00646B')>4.5);assert.ok(contrast('#ffffff','#aaccdd')<4.5);});
test('competitor screenshots reject local or non-HTTPS destinations',async()=>{for(const url of ['http://example.com','https://127.0.0.1','https://localhost','https://169.254.169.254','https://user:pass@example.com','https://example.com:3000'])assert.equal(await publicURL(url),false,url);});

test('hosted browser supports closing and reopening isolated contexts',()=>{const {hostedBrowserArgs}=require('./studio-quality.cjs');assert.deepEqual(hostedBrowserArgs(['--no-sandbox','--single-process','--no-zygote']),['--no-sandbox','--no-zygote']);});
test('a timed-out competitor screenshot is unavailable rather than a missing model attachment',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-reference-'));
 const page={goto:async()=>{},waitForTimeout:async()=>{},title:async()=>'Competitor',locator:()=>({innerText:async()=>'Observed real competitor content. '.repeat(20)}),screenshot:async()=>{throw Error('Screenshot timed out');},close:async()=>{}};
 const context={setDefaultTimeout:()=>{},route:async()=>{},routeWebSocket:async()=>{},newPage:async()=>page,close:async()=>{}};
 try{const {references}=require('./studio-quality.cjs');const refs=await references({newContext:async()=>context},[{websiteUrl:'https://example.com'}],dir);assert.equal(refs[0].observed,false);assert.equal(refs[0].screenshot,undefined);assert.match(refs[0].error,/timed out/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
