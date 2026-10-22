import test from 'node:test';
import assert from 'node:assert/strict';
import {listingUrl,identityFingerprint,verified,verificationSchema,generationSnapshot} from './generation';
const lead={businessName:'Real Pool Co',phone:'+16025550123',location:'Phoenix, AZ',service:'Pool care',profile:{address:'Phoenix, AZ'},competitors:Array.from({length:5},(_,i)=>({websiteUrl:`https://example${i}.com`}))};
const check={status:'verified',listingUrl:'https://www.google.com/maps/place/Real+Pool+Co/',reviewer:'daniel@alined.dev',identityFingerprint:identityFingerprint(lead)};
test('search links, shortened and spoofed Google hosts cannot verify a lead',()=>{
  for(const url of ['https://www.google.com/maps/search/?api=1&query=Real','https://google.com.evil.com/maps/place/Foo','https://maps.app.goo.gl/abc','http://www.google.com/maps/place/Foo'])assert.equal(listingUrl(url),false);
  assert.equal(listingUrl(check.listingUrl),true);
  assert.equal(listingUrl('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJtest'),true);
});
test('verification is bound to an approved reviewer and business identity',()=>{
  assert.equal(verified(lead,check),true);
  assert.equal(verified(lead,{...check,reviewer:'outsider@example.com'}),false);
  for(const change of [{businessName:'Other'},{phone:'+16025550124'},{location:'Miami'},{profile:{address:'New address'}}])assert.equal(verified({...lead,...change},check),false);
  assert.equal(verified({...lead,researchNotes:'Private note'},check),true);
});
test('manual verification requires three explicit matches and rejects forged reviewer',()=>{
  const input={expectedVersion:1,status:'verified',listingUrl:check.listingUrl,notes:'Matched name, phone and area.',nameMatched:true,phoneMatched:true,areaMatched:true};
  assert.ok(verificationSchema.safeParse(input).success);
  assert.equal(verificationSchema.safeParse({...input,phoneMatched:false}).success,false);
  assert.equal(verificationSchema.safeParse({...input,reviewer:'someone'}).success,false);
});
test('generation requires verified identity and five examples, excludes private notes',()=>{
  const s=generationSnapshot({...lead,researchNotes:'private',callHistory:['private']},check);
  assert.ok(!('researchNotes' in s));assert.ok(!('callHistory' in s));
  assert.throws(()=>generationSnapshot(lead,undefined),/Verify/);
  assert.throws(()=>generationSnapshot({...lead,competitors:[]},check),/five/);
  assert.throws(()=>generationSnapshot({...lead,callStatus:'Do not call'},check),/eligible/);
});
