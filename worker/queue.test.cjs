const test=require('node:test'),assert=require('node:assert/strict');
const {claim,fenced}=require('./queue.cjs');
test('worker leases serialize jobs, recover expired work and reject stale writers', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
  const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
  const app=initializeApp({projectId:'demo-daniboy'},'queue-worker-test'),db=getFirestore(app);
  try {
    const ref=db.doc('generations/worker-recovery-test');await ref.set({status:'publishing'});
    await ref.collection('artifacts').doc('page').set({html:'saved artifact'});
    const result=await Promise.all([claim(db,ref,'worker-a'),claim(db,ref,'worker-b')]);
    assert.equal(result.filter(Boolean).length,1);
    const first=result[0]?'worker-a':'worker-b',second=result[0]?'worker-b':'worker-a';
    await fenced(db,ref,first,{},true);
    await assert.rejects(fenced(db,ref,second,{status:'completed'}),/lease/);
    await db.doc('internal/generatorLock').update({until:Date.now()-1000});
    assert.equal(await claim(db,ref,second),true);
    await assert.rejects(fenced(db,ref,first,{status:'completed'}),/lease/);
    assert.equal((await ref.collection('artifacts').doc('page').get()).data().html,'saved artifact');
    await fenced(db,ref,second,{status:'completed'});
    await db.doc('internal/generatorLock').delete();
    assert.equal(await claim(db,ref,'third'),false);
  } finally {await deleteApp(app);}
});
