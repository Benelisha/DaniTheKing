// Package the shared renderer and browser worker inside the Firebase deployment.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dest=path.join(root,'functions/studio-runtime');
fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(path.join(dest,'worker'),{recursive:true});
for(const file of ['studio.cjs','studio-quality.cjs','browser.cjs']){
 let source=fs.readFileSync(path.join(root,'worker',file),'utf8');
 source=source.replace("const {connect}=require('./auth.cjs');","const connect=()=>{throw Error('Hosted runtime only');};").replaceAll("../functions/lib/","../../lib/");
 fs.writeFileSync(path.join(dest,'worker',file),source);
}
if(!fs.existsSync(path.join(root,'websites/dist/index.html')))throw Error('Build websites before packaging the studio worker');
fs.cpSync(path.join(root,'websites/dist'),path.join(dest,'websites/dist'),{recursive:true});
