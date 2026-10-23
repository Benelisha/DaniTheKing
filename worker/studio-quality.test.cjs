const test=require('node:test'),assert=require('node:assert/strict');
const {contrast,publicURL}=require('./studio-quality.cjs');
test('contrast measurement rejects weak generated colors',()=>{assert.equal(contrast('#ffffff','#000000'),21);assert.equal(contrast('#ffffff','#ffffff'),1);assert.ok(contrast('#ffffff','#00646B')>4.5);assert.ok(contrast('#ffffff','#aaccdd')<4.5);});
test('competitor screenshots reject local or non-HTTPS destinations',async()=>{for(const url of ['http://example.com','https://127.0.0.1','https://localhost','https://169.254.169.254','https://user:pass@example.com','https://example.com:3000'])assert.equal(await publicURL(url),false,url);});
