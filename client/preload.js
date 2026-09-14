const {contextBridge,ipcRenderer}=require('electron');
// Proces główny dodatkowo sprawdza dokładny adres lokalnego ekranu i główną ramkę.
if(location.protocol==='file:'&&location.pathname.endsWith('/settings.html'))contextBridge.exposeInMainWorld('andon',{getServer:()=>ipcRenderer.invoke('get-server'),saveServer:url=>ipcRenderer.invoke('save-server',url)});
