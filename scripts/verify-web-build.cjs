const fs = require('node:fs');
const path = require('node:path');
const folder = 'dist/_expo/static/js/web';
const code = fs.readdirSync(folder).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(path.join(folder,f),'utf8')).join('\n');
if(code.includes('demo-daniboy') || code.includes('localhost:5011') || !code.includes('https://daniboy-be1c0.web.app/api'))throw new Error('Production build has incorrect API/emulator configuration. Export with --clear.');
console.log('Verified production Firebase/API configuration; no QA backend bundled.');
