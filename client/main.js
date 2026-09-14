'use strict';
const {app,BrowserWindow,ipcMain,Menu,session}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
let win=null,serverOrigin=null;
const settingsFile=path.join(__dirname,'settings.html');
const settingsUrl=pathToFileURL(settingsFile).href;
function normalize(value){
 if(typeof value!=='string'||value.length>2048)throw new Error('Nieprawidłowy adres.');
 const raw=value.trim();if(!raw)throw new Error('Podaj adres serwera.');
 const u=new URL(/^[a-z]+:\/\//i.test(raw)?raw:'https://'+raw);
 const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if((u.protocol!=='https:'&&!(local&&u.protocol==='http:'))||u.username||u.password||u.search||u.hash)throw new Error('W sieci firmowej wymagany jest adres HTTPS.');
 if(u.pathname!=='/')throw new Error('Podaj główny adres serwera bez ścieżki panelu.');
 return u.href;
}
function configFile(){return path.join(app.getPath('userData'),'andon-client.json');}
function readServer(){if(process.env.ANDON_SERVER)return normalize(process.env.ANDON_SERVER);try{return normalize(JSON.parse(fs.readFileSync(configFile(),'utf8')).serverUrl);}catch{return '';}}
function settings(error){if(win)win.loadFile(settingsFile,error?{query:{err:error}}:undefined);}
function loadServer(value){const url=normalize(value);serverOrigin=new URL(url).origin;win.loadURL(url).catch(()=>settings('Nie udało się połączyć. Sprawdź adres i certyfikat serwera.'));}
function trustedSettings(event){return win&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url.split('?')[0]===settingsUrl;}
ipcMain.handle('get-server',event=>{if(!trustedSettings(event))throw new Error('Forbidden');return readServer();});
ipcMain.handle('save-server',(event,value)=>{
 if(!trustedSettings(event))throw new Error('Forbidden');
 try{if(process.env.ANDON_SERVER)throw new Error('Adres został ustalony przez administratora.');const url=normalize(value);fs.writeFileSync(configFile(),JSON.stringify({serverUrl:url}),{mode:0o600});loadServer(url);return {ok:true};}catch{return {ok:false,error:'Nie zapisano adresu. Podaj poprawny adres HTTPS lub localhost; sprawdź uprawnienia konfiguracji.'};}
});
function createWindow(){
 win=new BrowserWindow({width:1280,height:800,backgroundColor:'#0A0A0B',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const allowed=url=>{try{return new URL(url).origin===serverOrigin;}catch{return false;}};
 win.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
 win.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
 win.webContents.on('will-attach-webview',event=>event.preventDefault());
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Andon',submenu:[{label:'Zmień adres serwera…',accelerator:'CmdOrCtrl+,',click:()=>settings()},{label:'Odśwież',accelerator:'F5',click:()=>win&&win.reload()},{label:'Pełny ekran',accelerator:'F11',click:()=>win&&win.setFullScreen(!win.isFullScreen())},{type:'separator'},{role:'quit',label:'Zamknij'}]}]));
 win.maximize();try{const url=readServer();if(url)loadServer(url);else settings();}catch{settings('Nieprawidłowa konfiguracja ANDON_SERVER.');}win.on('closed',()=>{win=null;});
}
app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);createWindow();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});app.on('window-all-closed',()=>app.quit());
