const fs = require('node:fs');
fs.mkdirSync('dist/docs', { recursive: true });
for (const name of ['RESEARCH-BRIEF.md', 'BACKOFFICE-API.md', 'DAILY-RESEARCH.md']) {
  fs.copyFileSync(`docs/${name}`, `dist/docs/${name}`);
}
console.log('Exported Markdown research and API guides.');
