// Wymuś polską strefę czasową niezależnie od strefy hosta/procesu (np. serwer w UTC).
// Naprawia godziny w dzienniku zdarzeń, czasy cykli oraz parsowanie godzin w plannerze.
process.env.TZ = 'Europe/Warsaw';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serwer udostępnia pliki z folderu "public"
app.use(express.static('public'));

const CFG = { stations: ['y0','y1','y2','y3','y4'], netShiftMins: 420 };
const STATE_FILE = path.join(__dirname, 'andon_state.json'); // trwały zapis stanu

// BAZA DANYCH W PAMIĘCI SERWERA (Jedno źródło prawdy)
let DB = {
    goal: 15,
    taktMins: Math.floor(CFG.netShiftMins / 15),
    count: 0,
    target: Date.now() + (Math.floor(CFG.netShiftMins / 15) * 60000),
    isDown: false,
    downStart: null,
    accDown: 0,
    st: {},
    logs: [],
    isBreak: false,
    breakStart: null,
    cycleStart: Date.now(), // Stoper cyklu
    cycleTimes: [],         // Historia czasów
    // NOWOŚĆ: sterowanie czasem pracy zmiany
    shiftActive: false,          // czy zmiana trwa
    shiftStart: null,            // moment rozpoczęcia zmiany
    shiftStopTime: Date.now(),   // moment zamrożenia (na starcie: teraz => wszystko zamrożone)
    // NOWOŚĆ: planner czasu pracy (auto-start)
    planner: []                  // [{id, date:'YYYY-MM-DD', time:'HH:MM', status, startedAt}]
};
// Inicjalizacja stanowisk
CFG.stations.forEach(id => DB.st[id] = {r: false, s: false, reason: null});

// =========================================================
// TRWAŁOŚĆ STANU (plik JSON) — plan i stan przetrwają restart
// =========================================================
function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(DB)); }
    catch (e) { console.error('Błąd zapisu stanu:', e.message); }
}
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            DB = Object.assign(DB, saved);
            CFG.stations.forEach(id => { if (!DB.st[id]) DB.st[id] = { r: false, s: false, reason: null }; });
            if (!Array.isArray(DB.planner)) DB.planner = [];
            if (!Array.isArray(DB.logs)) DB.logs = [];
            if (!Array.isArray(DB.cycleTimes)) DB.cycleTimes = [];
            console.log('Wczytano zapisany stan z', STATE_FILE);
        }
    } catch (e) { console.error('Błąd wczytywania stanu:', e.message); }
}
loadState();

// zapis + rozgłoszenie do wszystkich ekranów
function broadcast() { saveState(); io.emit('sync', DB); }

function addLog(msg, detail = '', type = 'info') {
    const t = new Date().toLocaleTimeString('pl-PL');
    DB.logs.unshift({ t, m: msg, d: detail, type });
    if (DB.logs.length > 50) DB.logs.pop();
}

// =========================================================
// ROZPOCZĘCIE / ZATRZYMANIE ZMIANY
// =========================================================
function startShift(reason) {
    DB.count = 0;
    DB.accDown = 0;
    DB.isDown = false;
    DB.downStart = null;
    DB.cycleStart = Date.now();
    DB.cycleTimes = [];
    CFG.stations.forEach(id => { DB.st[id].r = false; DB.st[id].s = false; DB.st[id].reason = null; });
    DB.target = Date.now() + (DB.taktMins * 60000);
    DB.shiftActive = true;
    DB.shiftStart = Date.now();
    DB.shiftStopTime = null;
    addLog(reason || 'Zmiana rozpoczęta', `Cel: ${DB.goal} szt., takt: ${DB.taktMins} min`, 'info');
}
function stopShift(reason) {
    if (DB.isDown && DB.downStart) { DB.accDown += Math.floor((Date.now() - DB.downStart) / 1000); DB.downStart = null; }
    DB.isDown = false;
    DB.shiftActive = false;
    DB.shiftStopTime = Date.now();
    addLog(reason || 'Zmiana zatrzymana', `Wykonano: ${DB.count}/${DB.goal}`, 'alert');
}

// =========================================================
// PLANNER — automatyczny start wg harmonogramu
// =========================================================
const PLANNER_GRACE_MS = 60 * 60000; // do 60 min spóźnienia => nadal auto-start; starsze => pominięte
function checkPlanner() {
    const now = Date.now();
    let changed = false;
    (DB.planner || []).forEach(e => {
        if (e.status && e.status !== 'pending') return;
        const t = new Date(`${e.date}T${e.time}:00`).getTime();
        if (isNaN(t)) return;
        if (now >= t) {
            if (now - t <= PLANNER_GRACE_MS) {
                startShift(`Auto-start wg planu (${e.date} ${e.time})`);
                e.status = 'started'; e.startedAt = now;
            } else {                              // zbyt spóźnione (np. serwer był wyłączony)
                e.status = 'missed';
                addLog('Pominięto zaplanowany start', `${e.date} ${e.time} — spóźnienie ponad 60 min`, 'info');
            }
            changed = true;
        }
    });
    if (changed) broadcast();
}
setInterval(checkPlanner, 10000);

io.on('connection', (socket) => {
    console.log('Nowe urządzenie podłączone:', socket.id);

    // Natychmiastowa synchronizacja nowego urządzenia z serwerem
    socket.emit('sync', DB);

    // Ktoś kliknął POTWIERDŹ OK
    socket.on('actionOK', (user) => {
        if (!DB.shiftActive) return;                 // brak akcji poza aktywną zmianą
        if (!DB.st[user]) return;
        if (CFG.stations.includes(user) && DB.st[user].r === true) return; // Anti-spam

        DB.st[user].r = true;

        if (CFG.stations.includes(user)) {
            // Zapis czasu operacji w momencie kliknięcia
            const timeDiff = Math.floor((Date.now() - DB.cycleStart) / 1000);
            const mins = Math.floor(timeDiff / 60);
            const secs = timeDiff % 60;
            const currentTakt = DB.count + 1;

            DB.cycleTimes.unshift({ s: user.toUpperCase(), t: currentTakt, m: `${mins}m ${secs}s`, ts: new Date().toLocaleTimeString('pl-PL') });
            if (DB.cycleTimes.length > 200) DB.cycleTimes.pop();

            // Sprawdzenie czy wszyscy kliknęli
            if (CFG.stations.every(id => DB.st[id].r)) {
                DB.count++;
                DB.target = Date.now() + (DB.taktMins * 60000);
                DB.cycleStart = Date.now();

                if (DB.isDown) {
                    DB.accDown += Math.floor((Date.now() - DB.downStart) / 1000);
                    DB.isDown = false;
                    DB.downStart = null;
                }
                CFG.stations.forEach(id => DB.st[id].r = false);
                addLog(`Cykl zamknięty (Wykonano: ${DB.count}/${DB.goal})`);
            }
        } else {
            addLog(`Stanowisko ${user.toUpperCase()} zgłasza gotowość`);
        }

        broadcast();
    });

    // Wezwanie wsparcia
    socket.on('callSupport', (data) => {
        DB.st[data.user].s = true;
        DB.st[data.user].reason = data.reason;
        const detailMsg = data.comment ? `Powód: ${data.reason} | Komentarz: ${data.comment}` : `Powód: ${data.reason}`;
        addLog(`Wezwanie: ${data.user.toUpperCase()}`, `${detailMsg} (${data.userName})`, 'alert');
        broadcast();
    });

    socket.on('cancelSupport', (data) => {
        DB.st[data.user].s = false;
        DB.st[data.user].reason = null;
        addLog(`Anulowano wezwanie: ${data.user.toUpperCase()}`, `Wsparcie nie jest już wymagane.`, 'info');
        broadcast();
    });

    // Zarządzanie przez Brygadzistę (Bierze pod uwagę czas)
    socket.on('adminSettings', (data) => {
        DB.goal = data.goal;
        DB.taktMins = Math.floor(data.time / data.goal);
        DB.target = Date.now() + (DB.taktMins * 60000);
        DB.isDown = false;
        addLog(`Brygadzista ustawił cel: ${data.goal} szt. (Czas: ${data.time} min)`, `Nowy takt: ${DB.taktMins} min`, 'info');
        broadcast();
    });

    // NOWOŚĆ: Start / Stop zmiany (czas pracy)
    socket.on('shiftStart', () => { startShift('Zmiana rozpoczęta ręcznie'); broadcast(); });
    socket.on('shiftStop', () => { stopShift('Zmiana zatrzymana ręcznie'); broadcast(); });

    // NOWOŚĆ: Planner
    socket.on('plannerAdd', (data) => {
        if (!data || !data.date || !data.time) return;
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        DB.planner.push({ id, date: data.date, time: data.time, status: 'pending', startedAt: null });
        DB.planner.sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`));
        addLog('Dodano do plannera', `Start: ${data.date} ${data.time}`, 'info');
        broadcast();
        checkPlanner(); // jeśli termin już minął (w granicy tolerancji) — startuje od razu
    });
    socket.on('plannerRemove', (id) => {
        DB.planner = (DB.planner || []).filter(e => e.id !== id);
        broadcast();
    });

    // Synchronizacja czasu przestojów i przerw między ekranami
    socket.on('setDown', (calcNow) => {
        if (!DB.shiftActive) return;                 // brak przestoju poza aktywną zmianą
        if (!DB.isDown) {
            DB.isDown = true;
            DB.downStart = calcNow;
            addLog("Czas taktu przekroczony!", '', 'alert');
            broadcast();
        }
    });

    socket.on('setBreakStart', (now) => {
        if (!DB.isBreak) {
            DB.isBreak = true;
            DB.breakStart = now;
            broadcast();
        }
    });

    socket.on('setBreakEnd', (now) => {
        if (DB.isBreak) {
            DB.isBreak = false;
            const breakDuration = now - DB.breakStart;
            DB.target += breakDuration;
            if (DB.downStart) DB.downStart += breakDuration;
            broadcast();
        }
    });
});

// Aplikacja "podpina się" (bind) pod standardowy interfejs HTTP
const PORT = process.env.PORT || 80; 
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
