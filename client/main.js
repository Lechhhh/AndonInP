const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

// Adres serwera zapisujemy w katalogu danych użytkownika (zawsze zapisywalny, trwały).
// Można też wymusić z góry przez zmienną środowiskową ANDON_SERVER (np. przez GPO / skrót).
function configFile() {
    return path.join(app.getPath('userData'), 'andon-client.json');
}
function readServerUrl() {
    try {
        const f = configFile();
        if (fs.existsSync(f)) {
            const c = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (c && c.serverUrl) return c.serverUrl;
        }
    } catch (e) { /* ignore */ }
    return process.env.ANDON_SERVER || '';
}
function saveServerUrl(url) {
    try { fs.writeFileSync(configFile(), JSON.stringify({ serverUrl: url }, null, 2)); }
    catch (e) { /* ignore */ }
}
function normalize(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;   // domyślnie HTTP (serwer słucha na 80)
    return u.replace(/\/+$/, '') + '/';
}

function openSettings(err) {
    if (!win) return;
    win.loadFile(path.join(__dirname, 'settings.html'), err ? { query: { err } } : undefined);
}
function loadApp(url) {
    if (!win) return;
    win.loadURL(url).catch(() => openSettings('Nie udało się połączyć z: ' + url));
}

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: '#0A0A0B',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.maximize();

    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: 'Andon',
            submenu: [
                { label: 'Zmień adres serwera…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
                { label: 'Odśwież', accelerator: 'F5', click: () => win && win.reload() },
                { label: 'Pełny ekran', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
                { type: 'separator' },
                { role: 'quit', label: 'Zamknij' }
            ]
        }
    ]));

    const url = readServerUrl();
    if (url) loadApp(url); else openSettings();

    win.on('closed', () => { win = null; });
}

ipcMain.handle('get-server', () => readServerUrl());
ipcMain.handle('save-server', (e, url) => {
    const n = normalize(url);
    if (!n) return { ok: false, error: 'Podaj adres serwera.' };
    saveServerUrl(n);
    loadApp(n);
    return { ok: true };
});

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => app.quit());
