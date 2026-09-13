// Wymuś polską strefę czasową niezależnie od strefy hosta/procesu (np. serwer w UTC).
// Naprawia godziny w dzienniku zdarzeń, czasy cykli oraz parsowanie godzin w plannerze.
process.env.TZ = 'Europe/Warsaw';

const path = require('path');
const fs = require('fs');

// Podczas pracy z kodem plik .env jest odczytywany obok server.js.
// Po zbudowaniu przez pkg plik .env jest odczytywany obok andon.exe.
const ENV_FILE = process.pkg
    ? path.join(path.dirname(process.execPath), '.env')
    : path.join(__dirname, '.env');

const envResult = require('dotenv').config({ path: ENV_FILE });
if (envResult.error) {
    console.error('[Andon] Nie udało się odczytać pliku .env:', ENV_FILE);
    console.error('[Andon]', envResult.error.message);
} else {
    console.log('[Andon] Wczytano konfigurację z:', ENV_FILE);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serwer udostępnia pliki z folderu "public"
app.use(express.static('public'));

const CFG = { stations: ['x0','x1','x2','x3','x4'], netShiftMins: 420 };
const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
const ADMIN_PASSWORD = String(process.env.ANDON_ADMIN_PASSWORD || 'admin');
const OPERATOR_PASSWORD = String(process.env.ANDON_OPERATOR_PASSWORD || '123456');
console.log('[Andon] Webhook Discord:', DISCORD_WEBHOOK_URL ? `wczytany, długość: ${DISCORD_WEBHOOK_URL.length}` : 'BRAK');
const STATE_FILE = path.join(__dirname, 'andon_state.json'); // trwały zapis stanu

// BAZA DANYCH W PAMIĘCI SERWERA (Jedno źródło prawdy)
let DB = {
    goal: 15,
    netShiftMins: CFG.netShiftMins,
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
    try { const tmp = STATE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(DB, null, 2)); fs.renameSync(tmp, STATE_FILE); }
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
            if (!Number.isInteger(DB.netShiftMins) || DB.netShiftMins < 1) DB.netShiftMins = Math.max(1, DB.taktMins * DB.goal) || CFG.netShiftMins;
            console.log('Wczytano zapisany stan z', STATE_FILE);
        }
    } catch (e) { console.error('Błąd wczytywania stanu:', e.message); }
}
loadState();

// zapis + rozgłoszenie do wszystkich ekranów
function broadcast() { saveState(); io.emit('sync', DB); }

function validInt(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
function validPlanner(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return null;
    const t = new Date(`${date}T${time}:00`).getTime();
    return Number.isFinite(t) ? t : null;
}
function clean(value, max) { return String(value || '').trim().slice(0, max); }
function authorized(socket, roles, ack) {
    if (roles.includes(socket.data.role)) return true;
    if (typeof ack === 'function') ack({ ok: false, error: 'Brak uprawnień.' });
    return false;
}
async function sendDiscordSupport(data) {
    if (!DISCORD_WEBHOOK_URL) throw new Error('Brak konfiguracji DISCORD_WEBHOOK_URL');
    const description = [`Stanowisko: ${data.user.toUpperCase()}`, `Operator: ${data.userName}`, `Powód: ${data.reason}`, data.comment ? `Komentarz: ${data.comment}` : null].filter(Boolean).join('\n');
    const response = await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Andon System', embeds: [{ title: 'Wezwanie wsparcia', description, color: 15158332 }] }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
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
        const t = validPlanner(e.date, e.time);
        if (t === null) { e.status = 'invalid'; changed = true; return; }
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
    socket.data.role = null;
    socket.data.user = null;
    socket.on('login', (data, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const station = clean(data && data.station, 10).toLowerCase();
        const password = String(data && data.password || '');
        const adminRole = station === 'admin' || station === 'tv';
        const ok = adminRole ? password === ADMIN_PASSWORD : CFG.stations.includes(station) && password === OPERATOR_PASSWORD;
        if (!ok) return reply({ ok: false, error: 'Nieprawidłowe hasło. Spróbuj ponownie.' });
        socket.data.role = station;
        socket.data.user = station;
        reply({ ok: true, user: station, userName: station === 'admin' ? 'Brygadzista' : station === 'tv' ? 'Dashboard TV' : `Operator ${station.toUpperCase()}` });
    });

    // Ktoś kliknął POTWIERDŹ OK
    socket.on('actionOK', (ignored) => {
        if (!authorized(socket, CFG.stations)) return;
        const user = socket.data.user;
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

    // Wezwanie wsparcia. Webhook jest wywoływany wyłącznie na serwerze.
    socket.on('callSupport', async (data, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!authorized(socket, CFG.stations, reply)) return;
        const user = socket.data.user;
        const reason = clean(data && data.reason, 80);
        const comment = clean(data && data.comment, 500);
        if (!reason) return reply({ ok: false, error: 'Wybierz powód wezwania.' });
        const notification = { user, userName: `Operator ${user.toUpperCase()}`, reason, comment };
        try {
            await sendDiscordSupport(notification);
            DB.st[user].s = true;
            DB.st[user].reason = reason;
            const detailMsg = comment ? `Powód: ${reason} | Komentarz: ${comment}` : `Powód: ${reason}`;
            addLog(`Wezwanie: ${user.toUpperCase()}`, `${detailMsg} (${notification.userName})`, 'alert');
            broadcast();
            reply({ ok: true });
        } catch (e) {
            console.error('Błąd wysyłki webhooka Discord:', e.message);
            reply({ ok: false, error: 'Nie udało się wysłać zgłoszenia - spróbuj ponownie lub zawiadom brygadzistę osobiście.' });
        }
    });
    socket.on('cancelSupport', (data, ack) => {
        if (!authorized(socket, CFG.stations, ack)) return;
        const user = socket.data.user;
        DB.st[user].s = false;
        DB.st[user].reason = null;
        addLog(`Anulowano wezwanie: ${user.toUpperCase()}`, 'Wsparcie nie jest już wymagane.', 'info');
        broadcast();
        if (typeof ack === 'function') ack({ ok: true });
    });
    // Zarządzanie przez Brygadzistę (Bierze pod uwagę czas)
    socket.on('adminSettings', (data, ack) => {
        if (!authorized(socket, ['admin'], ack)) return;
        const goal = Number(data && data.goal), time = Number(data && data.time);
        if (!validInt(goal, 1, 10000) || !validInt(time, 1, 1440)) { if (typeof ack === 'function') ack({ ok: false, error: 'Podaj prawidłowy cel i czas od 1 do 1440 minut.' }); return; }
        DB.goal = goal;
        DB.netShiftMins = time;
        DB.taktMins = Math.max(1, Math.floor(time / goal));
        DB.target = Date.now() + (DB.taktMins * 60000);
        DB.isDown = false;
        addLog(`Brygadzista ustawił cel: ${goal} szt. (Czas: ${time} min)`, `Nowy takt: ${DB.taktMins} min`, 'info');
        broadcast();
    });

    // NOWOŚĆ: Start / Stop zmiany (czas pracy)
    socket.on('shiftStart', () => { if (!authorized(socket, ['admin'])) return; startShift('Zmiana rozpoczęta ręcznie'); broadcast(); });
    socket.on('shiftStop', () => { if (!authorized(socket, ['admin'])) return; stopShift('Zmiana zatrzymana ręcznie'); broadcast(); });

    // NOWOŚĆ: Planner
    socket.on('plannerAdd', (data) => {
        if (!authorized(socket, ['admin'])) return;
        if (!data || validPlanner(data.date, data.time) === null) return;
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        DB.planner.push({ id, date: data.date, time: data.time, status: 'pending', startedAt: null });
        DB.planner.sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`));
        addLog('Dodano do plannera', `Start: ${data.date} ${data.time}`, 'info');
        broadcast();
        checkPlanner(); // jeśli termin już minął (w granicy tolerancji) — startuje od razu
    });
    socket.on('plannerRemove', (id) => {
        if (!authorized(socket, ['admin'])) return;
        DB.planner = (DB.planner || []).filter(e => e.id !== id);
        broadcast();
    });

    // Synchronizacja czasu przestojów i przerw między ekranami
    socket.on('setDown', (calcNow) => {
        if (!authorized(socket, ['tv','admin'])) return;
        if (!Number.isFinite(Number(calcNow)) || Math.abs(Date.now() - Number(calcNow)) > 60000) return;
        if (!DB.shiftActive) return;                 // brak przestoju poza aktywną zmianą
        if (!DB.isDown) {
            DB.isDown = true;
            DB.downStart = calcNow;
            addLog("Czas taktu przekroczony!", '', 'alert');
            broadcast();
        }
    });

    socket.on('setBreakStart', (now) => {
        if (!authorized(socket, ['tv','admin'])) return;
        if (!Number.isFinite(Number(now)) || Math.abs(Date.now() - Number(now)) > 60000) return;
        if (!DB.isBreak) {
            DB.isBreak = true;
            DB.breakStart = now;
            broadcast();
        }
    });

    socket.on('setBreakEnd', (now) => {
        if (!authorized(socket, ['tv','admin'])) return;
        if (!Number.isFinite(Number(now))) return;
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
