const fs=require('node:fs/promises');
const {buildPage}=require('./page.cjs'),{validateRendered}=require('./browser.cjs');
(async()=>{
  const snapshot={businessName:'Validation Fixture Pool Care',phone:'+16025550123',location:'Phoenix',mapsUrl:'https://www.google.com/maps/place/Test/'};
  const {html}=buildPage({title:'Pool care in Phoenix',description:'Browser validation fixture, not a customer demo.',body:'<main><header><p>POOL CARE / PHOENIX</p><h1>Validation Fixture Pool Care</h1><p>+16025550123</p><a href="tel:+16025550123">Call for pool care</a></header><section><h2>A clear pool starts here</h2><p>Local service for your swimming pool.</p><a href="tel:+16025550123">Call now</a></section></main>',css:'body{font:18px system-ui;background:#eff8f4;color:#123b34}main{max-width:1100px;margin:auto;padding:24px}header{padding:80px 0}h1{font-size:clamp(32px,6vw,72px);max-width:850px}section{padding:90px 0}a{display:inline-block;background:#165e4b;color:white;padding:16px;border-radius:8px}p{line-height:1.6}'},snapshot,'fixture');
  const result=await validateRendered(html);if(result.errors.length)throw Error(result.errors.join('; '));
  await fs.mkdir('worker-artifacts/qa',{recursive:true});
  for(const shot of result.screenshots)await fs.writeFile(`worker-artifacts/qa/${shot.width}.jpg`,Buffer.from(shot.image,'base64'));
  console.log('Mobile and desktop render validation passed; screenshots in ignored worker-artifacts/qa.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
