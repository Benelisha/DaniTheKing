import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {discoverSocialPhotos,socialImageCandidates} from './studio-social';
test('social metadata uses photo URLs, resolves relative links and excludes unsafe schemes',()=>{
 assert.deepEqual(socialImageCandidates(`<meta content="/photo.jpg?a=1&amp;b=2" property="og:image"><meta name='twitter:image' content='javascript:alert(1)'><meta property="og:image" content="/photo.jpg?a=1&amp;b=2">`, 'https://instagram.com/business/'),['https://instagram.com/photo.jpg?a=1&b=2']);
});
test('public social photos preserve their profile source and skip small avatars',async()=>{
 const small=await sharp({create:{width:150,height:150,channels:3,background:'blue'}}).jpeg().toBuffer(),photo=await sharp({create:{width:1000,height:700,channels:3,background:'blue'}}).jpeg().toBuffer();
 const result=await discoverSocialPhotos([{platform:'Instagram',url:'https://instagram.com/business/'}],async url=>({status:200,headers:{'content-type':url.endsWith('/')?'text/html':'image/jpeg'},body:url.endsWith('/')?Buffer.from('<meta property="og:image" content="https://cdn.example/avatar.jpg"><script>{"display_url":"https://cdn.example/photo.jpg"}</script>'):url.includes('avatar')?small:photo}));
 assert.equal(result.length,1);assert.equal(result[0].sourceUrl,'https://instagram.com/business/');assert.equal(result[0].imageUrl,'https://cdn.example/photo.jpg');
});
test('blocked social profiles and failed resources allow the existing fallback',async()=>{
 assert.deepEqual(await discoverSocialPhotos([{platform:'Facebook',url:'https://facebook.com/business'}],async()=>({status:403,headers:{},body:Buffer.from('Access denied')})),[]);
});
