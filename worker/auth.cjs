const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { GoogleAuth } = require('google-auth-library');
const { PROJECT } = require('./hosting.cjs');
async function connect() {
  if (process.env.FIREBASE_CLI_AUTH === 'true') {
    // Opt-in reuse of this machine's existing CLI login; refresh token remains in memory.
    const path=require('node:path'), {execFileSync}=require('node:child_process');
    const root=path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'firebase-tools/lib');
    const {configstore}=require(path.join(root,'configstore'));
    const {requireAuth}=require(path.join(root,'requireAuth'));
    const {clientId,clientSecret}=require(path.join(root,'api'));
    await requireAuth({project:PROJECT,user:configstore.get('user'),tokens:configstore.get('tokens')});
    const credentials={type:'authorized_user',client_id:clientId(),client_secret:clientSecret(),refresh_token:configstore.get('tokens').refresh_token};
    const app=initializeApp({projectId:PROJECT});
    const database=getFirestore(app);database.settings({credentials});
    const auth=await new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
    return {database,auth};
  }
  const app=initializeApp({projectId:PROJECT,credential:applicationDefault()});
  return {database:getFirestore(app),auth:await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient()};
}
module.exports={connect};
