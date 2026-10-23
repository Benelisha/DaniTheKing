// Deterministic renderer coverage without paid model calls or customer data.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {openBrowser,capture}=require('./studio-quality.cjs');
async function main(){
 const dir=path.resolve('worker-artifacts/studio-qa');await fs.mkdir(dir,{recursive:true});
 const browser=await openBrowser();
 const image='https://fixture.example/hero.svg';
 const original=browser.newContext.bind(browser);
 browser.newContext=async(...args)=>{const ctx=await original(...args);await ctx.route(image,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900"><rect width="1000" height="900" fill="#d4c5aa"/><path d="M0 750L450 100L1000 600V900H0Z" fill="#526654"/><circle cx="750" cy="200" r="100" fill="#f5e9ce"/></svg>'}));return ctx;};
 const sections=[{id:'services',kind:'services',title:'Find the right care for your garden',body:'Choose a service to start a conversation.',items:[{title:'Garden maintenance',body:'Discuss the care your planting needs.'}]},{id:'process',kind:'process',title:'Start with your garden',items:[{title:'Choose a service',body:'Tell us what you need.'},{title:'Share the details',body:'Describe your space.'},{title:'Discuss next steps',body:'Ask about availability and scope.'}]},{id:'faq',kind:'faq',title:'Before you get in touch',items:[{title:'What should I share?',body:'Your location and a description of your garden.'},{title:'How can I contact you?',body:'Call or email using the details below.'},{title:'Can I discuss maintenance?',body:'Select garden maintenance to begin an inquiry.'}]},{id:'areas',kind:'areas',title:'Rooted in Bristol',items:[]},{id:'contact',kind:'contact',title:'Tell us about your garden',items:[]}].map(s=>({eyebrow:'',body:'',imageIndex:null,...s}));
 const site={business:{businessName:'Field & Form',service:'Garden care',location:'Bristol',phone:'+441170000000',email:'garden@example.com'},content:{headline:'A little more life in your garden.',intro:'Garden maintenance in Bristol. Tell us about your outdoor space and the care you have in mind.',cta:'Discuss your garden',imageUrl:image,assets:[{url:image}],services:[{title:'Garden maintenance',description:'Discuss the care your planting needs.'}],about:'Garden care in Bristol.',sections},blueprint:{sections},design:{accent:'#365643',background:'#f6f3ec',ink:'#172c24',cornerRadius:8,heroLayout:'split',fontStyle:'editorial'}};
 try{for(const style of ['editorial','bold','minimal']){
  site.design.visualStyle=style;site.design.serviceLayout=style==='minimal'?'list':'cards';site.design.imageShape=style==='editorial'?'arch':'rounded';site.design.heroLayout=style==='minimal'?'centered':'split';
  const result=await capture(browser,site,dir,style);assert.equal(result.checks.passed,true,JSON.stringify(result.checks));console.log(`${style}: desktop/mobile layout, images, FAQ, CTA, service selection and contrast passed`);
 }}finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
