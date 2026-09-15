'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {io}=require('socket.io-client');
const {configFrom}=require('../lib/config');
const {createApplication}=require('../lib/server-app');
const proxyaddr=require('proxy-addr');
const express=require('express');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'andon-public-test-'));
 const env={NODE_ENV:'production',PORT:'0',ANDON_PUBLIC_TEST_MODE:'true',ANDON_TRUST_PROXY:'127.0.0.1/32',ANDON_ALLOWED_ORIGINS:'https://andon.example',ANDON_MASTER_KEY:crypto.randomBytes(32).toString('base64'),ANDON_DATA_DIR:path.join(root,'data'),ANDON_STATE_FILE:path.join(root,'state')};
 return {root,env};
}
test('Publiczny test wymaga jawnej zgody i zachowuje wymagania produkcyjne',()=>{
 const {root,env}=fixture();
 assert.equal(configFrom(env,root).publicTestMode,true);
 for(const value of [undefined,'','false'])assert.throws(()=>configFrom({...env,ANDON_PUBLIC_TEST_MODE:value},root),/ANDON_ALLOWED_CLIENTS/);
 for(const value of ['TRUE','1','yes'])assert.throws(()=>configFrom({...env,ANDON_PUBLIC_TEST_MODE:value},root),/true albo false/);
 assert.throws(()=>configFrom({...env,ANDON_ALLOWED_CLIENTS:'203.0.113.10/32'},root),/pustego ANDON_ALLOWED_CLIENTS/);
 assert.throws(()=>configFrom({...env,ANDON_ALLOWED_ORIGINS:''},root),/HTTPS/);
 assert.throws(()=>configFrom({...env,ANDON_TRUST_PROXY:''},root),/HTTPS/);
 assert.throws(()=>configFrom({...env,ANDON_TRUST_PROXY:'true'},root),/konkretne adresy/);
 assert.throws(()=>configFrom({...env,ANDON_MASTER_KEY:''},root),/klucza/);
 assert.deepEqual(configFrom({...env,ANDON_PUBLIC_TEST_MODE:'false',ANDON_ALLOWED_CLIENTS:'203.0.113.10/32'},root).allowedClients,['203.0.113.10/32']);
});
test('Proxy Render jest ograniczone do publicznego testu i nie ufa całemu łańcuchowi XFF',()=>{
 const {root,env}=fixture(),renderEnv={...env,RENDER:'true',ANDON_TRUST_PROXY:'render'};
 const config=configFrom(renderEnv,root);assert.equal(config.proxy,1);
 for(const changes of [{RENDER:undefined},{RENDER:'false'},{NODE_ENV:'development'},{ANDON_PUBLIC_TEST_MODE:'false',ANDON_ALLOWED_CLIENTS:'203.0.113.10/32'},{ANDON_TLS_CERT_FILE:'cert.pem',ANDON_TLS_KEY_FILE:'key.pem'}]){
  assert.throws(()=>configFrom({...renderEnv,...changes},root),/ANDON_TRUST_PROXY=render/);
 }
 const app=express();app.set('trust proxy',config.proxy);const trust=app.get('trust proxy fn');
 const request=xff=>({socket:{remoteAddress:'10.0.0.2'},headers:{'x-forwarded-for':xff}});
 assert.equal(proxyaddr(request('203.0.113.10'),trust),'203.0.113.10');
 assert.equal(proxyaddr(request('198.51.100.77, 203.0.113.10'),trust),'203.0.113.10');
 assert.equal(proxyaddr(request('198.51.100.88, 203.0.113.10, 10.0.0.3'),trust),'10.0.0.3');
});
for(const proxy of ['127.0.0.1/32','render'])test('Publiczny test ('+proxy+'): różne IP, wymagane HTTPS, origin i logowanie Socket.IO',async t=>{
 const {env}=fixture(),app=await createApplication(configFrom({...env,RENDER:'true',ANDON_TRUST_PROXY:proxy},path.resolve(__dirname,'..')));
 t.after(()=>app.close());
 const address=await app.listen(),url='http://127.0.0.1:'+address.port;
 const headers={Origin:'https://andon.example','X-Forwarded-Proto':'https','X-Forwarded-For':'203.0.113.10'};
 let session,cookie;
 for(const clientIp of ['203.0.113.10','198.51.100.20','2001:db8::42']){
  const response=await fetch(url+'/api/session',{headers:{...headers,'X-Forwarded-For':clientIp}});
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/__Host-andon=.*Secure/);
  session=await response.json();assert.equal(session.authenticated,false);cookie=response.headers.get('set-cookie').split(';')[0];
 }
 assert.equal((await fetch(url+'/api/session',{headers:{...headers,'X-Forwarded-Proto':'http'}})).status,426);
 assert.equal((await fetch(url+'/api/session',{headers:{...headers,Origin:'https://foreign.example'}})).status,403);
 assert.equal((await fetch(url+'/api/login',{method:'POST',headers:{...headers,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({code:'99999999'})})).status,403);
 const socket=io(url,{autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{...headers,Cookie:cookie},auth:{view:'tv',csrfToken:session.csrfToken}});
 t.after(()=>socket.disconnect());
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.disconnect();reject(new Error('Brak odmowy anonimowego połączenia'));},3000);
  socket.once('connect',()=>{clearTimeout(timer);reject(new Error('Anonimowy dostęp do TV'));});
  socket.once('connect_error',()=>{clearTimeout(timer);resolve();});
  socket.connect();
 });
 const loginResponse=await fetch(url+'/api/login',{method:'POST',headers:{...headers,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({code:app.accounts.state.users[0].number})});
 assert.equal(loginResponse.status,200);const loggedIn=await loginResponse.json();assert.equal(loggedIn.authenticated,true);
 const authenticated=io(url,{autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{...headers,Cookie:loginResponse.headers.get('set-cookie').split(';')[0]},auth:{view:'tv',csrfToken:loggedIn.csrfToken}});
 t.after(()=>authenticated.disconnect());
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{authenticated.disconnect();reject(new Error('Brak synchronizacji po logowaniu'));},3000);
  authenticated.once('sync',state=>{clearTimeout(timer);try{assert(state.st);resolve();}catch(error){reject(error);}});
  authenticated.once('connect_error',error=>{clearTimeout(timer);reject(error);});
  authenticated.connect();
 });
});
