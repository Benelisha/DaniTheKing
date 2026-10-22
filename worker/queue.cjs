async function claim(database,ref,workerId) {
  return database.runTransaction(async tx=>{
    const lock=database.doc('internal/generatorLock');
    const [l,j]=await Promise.all([tx.get(lock),tx.get(ref)]);
    if (!j.exists || ['completed','failed'].includes(j.data().status) || (l.exists && l.data().until>Date.now())) return false;
    tx.set(lock,{workerId,jobId:ref.id,until:Date.now()+180000});
    tx.update(ref,{workerId,leaseUntil:Date.now()+180000});return true;
  });
}
async function fenced(database,ref,workerId,patch={},renew=false) {
  await database.runTransaction(async tx=>{
    const lock=database.doc('internal/generatorLock');
    const l=await tx.get(lock);
    if (l.data()?.workerId!==workerId || l.data()?.jobId!==ref.id || l.data()?.until<Date.now()) throw Error('Worker lease expired; another worker may resume this job.');
    if (renew) tx.update(lock,{until:Date.now()+180000});
    tx.update(ref,{...patch,updatedAt:new Date().toISOString(),...(renew?{leaseUntil:Date.now()+180000}:{})});
  });
}
module.exports={claim,fenced};
