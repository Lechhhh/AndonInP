'use strict';
process.env.TZ = 'Europe/Warsaw';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {configFrom}=require('./lib/config'),{createApplication}=require('./lib/server-app');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'andon-ui-check-'));
 const config=configFrom({PORT:'0',ANDON_DATA_DIR:path.join(dir,'data'),ANDON_STATE_FILE:path.join(dir,'state'),ANDON_MASTER_KEY:crypto.randomBytes(32).toString('base64')},__dirname);
 const app=await createApplication(config),user=app.accounts.state.users[0];user.name='Test interfejsu';
 app.line.change('shiftStart',{requestId:crypto.randomUUID()},user,'panel');
 const state=structuredClone(app.line.state);state.st.y0.r=true;state.st.y1.s=true;state.st.y1.reason='Awaria Maszyny';state.count=7;app.line.commit(state);
 const address=await app.listen();console.log('Preview: http://127.0.0.1:'+address.port);
 process.on('SIGINT',()=>app.close().then(()=>process.exit()));
})();
