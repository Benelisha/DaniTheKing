const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
if(process.platform!=='darwin')throw Error('This installer is for macOS. Run npm run worker:studio on other systems.');
const root=path.resolve(__dirname,'..'),label='dev.benlish.daniboy.website-studio',folder=path.join(os.homedir(),'Library/LaunchAgents'),file=path.join(folder,label+'.plist');
const codex=execFileSync('/bin/zsh',['-lc','command -v codex'],{encoding:'utf8'}).trim();
const xml=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(root,'worker-artifacts'),{recursive:true});
fs.writeFileSync(file,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(root,'worker/studio.cjs'))}</string></array><key>WorkingDirectory</key><string>${xml(root)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH)}</string><key>HOME</key><string>${xml(os.homedir())}</string><key>FIREBASE_CLI_AUTH</key><string>true</string><key>CODEX_BIN</key><string>${xml(codex)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(path.join(root,'worker-artifacts/studio-worker.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(root,'worker-artifacts/studio-worker.log'))}</string></dict></plist>`);
try{execFileSync('launchctl',['bootout',`gui/${process.getuid()}/${label}`],{stdio:'ignore'});}catch{}
// bootout returns before launchd has fully released the label.
for(let attempt=0;;attempt++){
 try{execFileSync('launchctl',['bootstrap',`gui/${process.getuid()}`,file],{stdio:attempt===3?'inherit':'pipe'});break;}
 catch(error){if(attempt>=3)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);}
}
console.log('Website studio worker installed and started. Logs: '+path.join(root,'worker-artifacts/studio-worker.log'));
