'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Vault,loadKey,atomicWrite}=require('../lib/vault');const {configFrom}=require('../lib/config');const {acquireLocks}=require('../lib/lock');const {HistoryDatabase}=require('../lib/history');
require('dotenv').config({quiet:true});
const [command,target]=process.argv.slice(2);
function checksum(file){const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024),hash=crypto.createHash('sha256');try{let length;while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length));return hash.digest('hex');}finally{fs.closeSync(fd);}}
try{
 if(!['backup','verify','restore'].includes(command)||!target)throw new Error('Invalid command.');
 const c=configFrom(),v=new Vault(loadKey(c));
 if(command==='backup'){
  const release=acquireLocks([c.accountsFile,c.stateFile,c.historyFile]);let history;
  try{
   if(fs.existsSync(target)||fs.existsSync(target+'.history.sqlite'))throw new Error('Destination exists.');
   const accounts=v.read(c.accountsFile,'accounts');history=fs.existsSync(c.historyFile)?new HistoryDatabase(c.historyFile,v):null;
   const line=history?history.readState():v.read(c.stateFile,'line');if(!accounts||!line||line.schema!==2)throw new Error('Missing state.');
   fs.mkdirSync(path.dirname(path.resolve(target)),{recursive:true,mode:0o700});let historyHash=null;
   if(history){history.verify();history.checkpoint();history.close();history=null;fs.copyFileSync(c.historyFile,target+'.history.sqlite',fs.constants.COPYFILE_EXCL);historyHash=checksum(target+'.history.sqlite');}
   fs.writeFileSync(target,v.seal({schema:2,createdAt:new Date().toISOString(),accounts,line,historyHash},'backup'),{flag:'wx',mode:0o600});console.log('Utworzono szyfrowaną kopię. Zachowaj plik .enc i jego .history.sqlite razem; klucz osobno.');
  }finally{if(history)history.close();release();}
 }else{
  const source=process.env.ANDON_BACKUP_FILE||target,data=v.read(source,'backup');if(![1,2].includes(data?.schema)||data.accounts?.schema!==2||data.line?.schema!==2)throw new Error('Invalid backup.');
  if(data.historyHash){if(checksum(source+'.history.sqlite')!==data.historyHash)throw new Error('History checksum mismatch.');const db=new HistoryDatabase(source+'.history.sqlite',v,{readOnly:true});try{db.verify();if(JSON.stringify(db.readState())!==JSON.stringify(data.line))throw new Error('Inconsistent state.');}finally{db.close();}}
  if(command==='restore'){
   if(!process.env.ANDON_BACKUP_FILE)throw new Error('ANDON_BACKUP_FILE required.');const dest=path.resolve(target);if(fs.existsSync(dest))throw new Error('Destination exists.');
   fs.mkdirSync(dest,{recursive:false,mode:0o700});atomicWrite(path.join(dest,'accounts.json'),v.seal(data.accounts,'accounts'));atomicWrite(path.join(dest,'andon_state.json'),v.seal(data.historyHash?{schema:3,historyDatabase:true}:data.line,'line'));if(data.historyHash)fs.copyFileSync(source+'.history.sqlite',path.join(dest,'history.sqlite'),fs.constants.COPYFILE_EXCL);console.log('Odtworzono konta, stan oraz dostępną historię w nowym katalogu. Użyj tego samego klucza.');
  }else console.log('Kopia poprawna: zweryfikowano integralność i odczyt kont, stanu oraz historii.');
 }
}catch{console.error('Operacja kopii nie powiodła się. Sprawdź polecenie, klucz, uprawnienia, pliki kopii i zatrzymanie serwera.');process.exitCode=1;}
