'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Jeden proces na zestaw danych. Po awarii osierocona blokada jest odzyskiwana.
function acquireLocks(files){const held=[];function release(){for(const {file,token} of held){try{if(JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file);}catch{}}}
 try{for(const resource of [...new Set(files.map(f=>path.resolve(f)))].sort()){
  const file=resource+'.lock',token=crypto.randomUUID();fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  for(let attempt=0;attempt<2;attempt++){
   try{fs.writeFileSync(file,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});held.push({file,token});break;}
   catch(error){if(error.code!=='EEXIST')throw error;let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Nieprawidłowa blokada danych. Administrator musi sprawdzić proces serwera.');}
    if(!Number.isInteger(old.pid)||old.pid<1)throw new Error('Nieprawidłowa blokada procesu.');
    try{process.kill(old.pid,0);throw new Error('Dane są używane przez inny proces Andon.');}catch(e){if(e.code!=='ESRCH')throw e;}
    if(attempt===1)throw new Error('Nie udało się przejąć blokady danych.');fs.unlinkSync(file);
   }
  }
 }return release;}catch(error){release();throw error;}
}
module.exports={acquireLocks};
