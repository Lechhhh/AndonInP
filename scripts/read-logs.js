'use strict';
const fs=require('node:fs');const {configFrom}=require('../lib/config');const {Vault,loadKey}=require('../lib/vault');
require('dotenv').config({quiet:true});
try{const file=process.argv[2];if(!file)throw new Error();const v=new Vault(loadKey(configFrom()));const lines=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);for(const line of lines)console.log(JSON.stringify(v.open(line,'security-log')));}catch{console.error('Nie odczytano logu. Sprawdź plik, klucz i uprawnienia.');process.exitCode=1;}
