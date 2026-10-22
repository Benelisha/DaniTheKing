const test=require('node:test'),assert=require('node:assert/strict');
const {publish,SITE}=require('./hosting.cjs');
const auth={getAccessToken:async()=>({token:'test-token'})};
test('Hosting publishing preserves existing files and checks live output before returning URL',async()=>{
  const oldFetch=global.fetch,calls=[];
  global.fetch=async(url,options={})=>{
    const u=String(url);calls.push([u,options]);
    let body={};
    if(u.includes('/releases?pageSize'))body={releases:[{version:{name:`sites/${SITE}/versions/previous`}}]};
    else if(u.includes('/previous/files'))body={files:[{path:'/other/index.html',hash:'existing-hash'}]};
    else if(u.endsWith('/versions'))body={name:`sites/${SITE}/versions/next`};
    else if(u.includes(':populateFiles')){const files=JSON.parse(options.body).files;assert.equal(files['/other/index.html'],'existing-hash');assert.ok(files['/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html']);body={uploadRequiredHashes:[]};}
    else if(u.startsWith(`https://${SITE}.web.app`))return new Response('<meta name="generation-id" content="job"><meta name="robots" content="noindex">');
    return new Response(JSON.stringify(body),{status:200});
  };
  try{
    const result=await publish(auth,'a'.repeat(32),{html:'<html>demo</html>'},'job',async()=>{},async()=>{});
    assert.equal(result,`https://${SITE}.web.app/${'a'.repeat(32)}/`);
    assert.ok(calls.some(([u])=>u.includes('versionName=')));
    assert.ok(!calls.some(([u])=>u.includes('sites/daniboy-be1c0/')));
  }finally{global.fetch=oldFetch;}
});
test('a missing old asset prevents release rather than deleting another prospect',async()=>{
  const oldFetch=global.fetch;let released=false;
  global.fetch=async(url)=>{
    const u=String(url);let body={};
    if(u.includes('releases?pageSize'))body={releases:[]};
    else if(u.endsWith('/versions'))body={name:`sites/${SITE}/versions/test`};
    else if(u.includes(':populateFiles'))body={uploadRequiredHashes:['missing-old-hash']};
    else if(u.includes('versionName='))released=true;
    return new Response(JSON.stringify(body));
  };
  try{await assert.rejects(publish(auth,'a'.repeat(32),{html:'page'},'job',async()=>{},async()=>{}),/preserve/);assert.equal(released,false);}finally{global.fetch=oldFetch;}
});
