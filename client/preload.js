const { contextBridge, ipcRenderer } = require('electron');

// Most między ekranem ustawień (settings.html) a procesem głównym.
// Załadowana aplikacja Andon z serwera tego nie używa — jest nieszkodliwe.
contextBridge.exposeInMainWorld('andon', {
    getServer: () => ipcRenderer.invoke('get-server'),
    saveServer: (url) => ipcRenderer.invoke('save-server', url)
});
