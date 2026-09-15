'use strict';
const $ = id => document.getElementById(id);
const socket = io({autoConnect:false,reconnection:true,reconnectionDelayMax:5000});
const roleNames = { owner: 'Właściciel', manager: 'Brygadzista', employee: 'Pracownik' };
let identity = null, state = null, users = [], usersVersion = null, editorVersion = null, initialized = false;
let userPage=1,totalUsers=0;
let plannerSignature = '', confirmResolve = null;

function applyPanelTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', selected);
    try { localStorage.setItem('theme', selected); } catch {}
    const logo = document.querySelector('.brand img');
    if (logo) logo.src = selected === 'light' ? '/logo.png' : '/logo2.png';
    document.querySelectorAll('[data-panel-theme]').forEach(button => {
        const active = button.dataset.panelTheme === selected;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}
document.querySelectorAll('[data-panel-theme]').forEach(button => button.addEventListener('click', () => applyPanelTheme(button.dataset.panelTheme)));
applyPanelTheme(document.documentElement.getAttribute('data-theme') || 'dark');

let resuming = false;

function request(event, data = null) {
    return new Promise((resolve, reject) => {
        if (!socket.connected) return reject(new Error('Brak połączenia z serwerem.'));
        const mutations=['adminSettings','shiftStart','shiftStop','plannerAdd','plannerRemove','setBreakOverlayDisabled'];
        if(mutations.includes(event)) {
            if (!state) return reject(new Error('Poczekaj na aktualne dane z serwera.'));
            data={...(data||{}),requestId:AndonAuth.requestId()};
        }
        socket.timeout(10000).emit(event, data, (error, result) => {
            if (error) return reject(new Error('Serwer nie odpowiedział. Odśwież dane przed ponowieniem operacji.'));
            if (!result || !result.ok) return reject(new Error(result && result.error || 'Operacja nie powiodła się.'));
            resolve(result);
        });
    });
}
function message(text, error = false) {
    $('message').textContent = text;
    $('message').className = error ? 'error' : '';
    $('message').hidden = false;
}
async function perform(button, fn) {
    button.disabled = true;
    try { await fn(); } catch (error) { message(error.message, true); } finally { button.disabled = false; }
}
function reset(error = '') {
    SupportSound.reset(); identity = null; state = null; users = []; usersVersion = null; initialized = false; plannerSignature = ''; resuming = false;
    $('workspace').hidden = true; $('login-view').hidden = false; $('login-error').textContent = error;
    $('identity').textContent = ''; $('people-rows').replaceChildren(); $('audit-rows').replaceChildren();
    $('access-code').value = ''; $('person-form').reset(); $('message').hidden = true;
    $('person-dialog').close(); $('confirm-dialog').close();HistoryPanel.reset();
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
}
socket.on('connect_error', error => {
    $('connection').textContent = 'Brak połączenia z serwerem. Ponawiam łączenie…'; $('connection').hidden = false;
    if (error.data?.code) { reset('Sesja wygasła lub dostęp został zmieniony. Zaloguj się ponownie.'); socket.disconnect(); }
});
socket.on('disconnect', reason => {
    if (identity && ['transport close', 'transport error', 'ping timeout'].includes(reason)) {
        state = null; resuming = true;
        $('stop-shift').disabled = true; $('start-shift').disabled = true;
        document.querySelector('#settings-form button').disabled = true;
        $('connection').textContent = 'Połączenie przerwane. Ponawiam łączenie — dane mogą być nieaktualne.';
        $('connection').hidden = false;
        return;
    }
    const hadSession = Boolean(identity);
    reset(hadSession ? 'Sesja zakończona. Po przywróceniu połączenia zaloguj się ponownie.' : $('login-error').textContent);
    $('connection').textContent = 'Połączenie zostało przerwane.'; $('connection').hidden = false;

});
socket.on('sessionRevoked', result => { reset(result.error); socket.disconnect(); });
const reconnect = () => { if (identity && !socket.connected && socket.active) socket.connect(); };
window.addEventListener('online', reconnect);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnect(); });
socket.on('sync', data => {
    if (!identity) return;
    $('connection').hidden = true;
    state = data; SupportSound.sync(data);
    if (!initialized) { $('goal').value = data.goal; $('net-time').value = data.netShiftMins; initialized = true; }
    renderProduction();
    if (resuming) {
        resuming = false;
        if (identity.role === 'owner') loadUsers().catch(error => message(error.message, true));
        if (!$('reports').hidden) HistoryPanel.open();
    }
});
socket.on('serviceError',result=>message(result.error,true));
socket.on('usersChanged', () => { if (identity && identity.role === 'owner') loadUsers().catch(e => message(e.message, true)); });
$('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter; button.disabled = true; $('login-error').textContent = '';
    const code = $('access-code').value.trim(); $('access-code').value = '';
    try {
        const result = await AndonAuth.login(code);
        identity = result;
        $('identity').textContent = result.userName + ' · ' + result.roleName;
        $('login-view').hidden = true; $('workspace').hidden = false;
        $('people-tab').hidden = result.role !== 'owner'; $('audit-tab').hidden = result.role !== 'owner';
        switchTab('production');
        await AndonAuth.connect(socket,'panel');
        if (result.role === 'owner') await loadUsers();
    } catch (error) { reset(error.message);socket.disconnect(); }
    finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await AndonAuth.logout(); } catch { /* Serwer dodatkowo ogranicza ważność sesji. */ } finally { reset(); socket.disconnect(); } });
function switchTab(id) {
    if (['people','audit'].includes(id) && (!identity || identity.role !== 'owner')) return;
    document.querySelectorAll('.tab-page').forEach(el => { el.hidden = el.id !== id; });
    if(id==='reports')HistoryPanel.open();
    document.querySelectorAll('[data-tab]').forEach(button => { const selected = button.dataset.tab === id; button.classList.toggle('selected', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
function duration(seconds) { return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':'); }
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function renderProduction() {
    if (!state) return;
    $('shift-status').textContent = state.count >= state.goal ? 'CEL OSIĄGNIĘTY' : state.shiftActive ? (state.isBreak ? 'PRZERWA' : state.isDown ? 'PRZESTÓJ' : 'AKTYWNA') : 'ZATRZYMANA';
    $('production-count').textContent = state.count + ' / ' + state.goal;
    $('production-takt').textContent = Number(state.taktMins.toFixed(2)) + ' min';
    const end = state.shiftActive ? state.serverTime : state.shiftStopTime;
    $('shift-elapsed').textContent = duration(state.shiftStart ? Math.max(0, Math.floor((end - state.shiftStart) / 1000)) : 0);
    $('stop-shift').disabled = !state.shiftActive;$('start-shift').disabled=state.shiftActive;document.querySelector('#settings-form button').disabled=state.shiftActive;
    $('break-overlay-state').textContent = state.breakOverlayDisabled ? 'Nakładka wyłączona. Przerwy nadal są liczone.' : 'Nakładka włączona — pojawia się podczas przerwy.';
    $('toggle-break-overlay').textContent = state.breakOverlayDisabled ? 'Włącz nakładkę przerwy' : 'Wyłącz nakładkę przerwy';
    const signature = JSON.stringify(state.planner);
    if (signature === plannerSignature) return;
    plannerSignature = signature;
    const rows = (state.planner || []).map(entry => {
        const row = node('div', undefined, 'plan-row'), info = node('div', entry.date + ' · ' + entry.time);
        info.append(node('small', { pending: 'Oczekuje', started: 'Uruchomiono', missed: 'Pominięto', invalid: 'Nieprawidłowy termin', conflict:'Pominięto: zmiana trwa' }[entry.status] || 'Oczekuje'));
        const remove = node('button', 'Usuń', 'secondary');
        remove.addEventListener('click', () => perform(remove, async () => { if (await confirmAction('Usunąć termin?', entry.date + ' · ' + entry.time)) await request('plannerRemove', {id:entry.id}); }));
        row.append(info, remove); return row;
    });
    $('planner-list').replaceChildren(...(rows.length ? rows : [node('p', 'Brak zaplanowanych rozpoczęć.')]));
}
setInterval(() => { if (identity && state) { renderProduction(); } }, 1000);
$('settings-form').addEventListener('submit', event => { event.preventDefault(); perform(event.submitter, async () => {
    await request('adminSettings', { goal: Number($('goal').value), time: Number($('net-time').value) }); message('Zapisano cel i czas pracy.');
}); });
$('planner-form').addEventListener('submit', event => { event.preventDefault(); perform(event.submitter, async () => {
    await request('plannerAdd', { date: $('plan-date').value, time:$('plan-hour').value+':'+$('plan-minute').value }); $('plan-hour').value='';$('plan-minute').value=''; message('Dodano termin rozpoczęcia zmiany.');
}); });
function confirmAction(title, text) {
    if (confirmResolve) return Promise.resolve(false);
    $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-dialog').showModal();
    return new Promise(resolve => { confirmResolve = resolve; });
}
function finishConfirm(ok) { if (confirmResolve) { const resolve = confirmResolve; confirmResolve = null; $('confirm-dialog').close(); resolve(ok); } }
$('confirm-ok').addEventListener('click', () => finishConfirm(true));
$('confirm-cancel').addEventListener('click', () => finishConfirm(false));
$('confirm-dialog').addEventListener('cancel', () => finishConfirm(false));
$('start-shift').addEventListener('click', event => perform(event.currentTarget, async () => {
    if (await confirmAction('Rozpocząć nową zmianę?', 'Bieżąca produkcja, przestoje i pomiary cykli zostaną wyzerowane.')) { await request('shiftStart'); message('Rozpoczęto nową zmianę.'); }
}));
$('stop-shift').addEventListener('click', event => perform(event.currentTarget, async () => {
    if (await confirmAction('Zatrzymać zmianę?', 'Czas pracy zostanie zamrożony.')) { await request('shiftStop'); message('Zatrzymano zmianę.'); }
}));
async function loadUsers() {
    const session = identity;
    const result = await request('usersList',{search:$('search').value.trim(),page:userPage,limit:25});
    if (identity !== session) return;
    users = result.users; usersVersion = result.version; totalUsers=result.total;renderPeople();$('page-info').textContent='Strona '+userPage+' · Osób: '+totalUsers;$('previous-page').disabled=userPage<=1;$('next-page').disabled=userPage*25>=totalUsers;
    const rows = result.audit.map(entry => {
        const row = node('tr');
        const after = entry.after || {};
        const details = (after.name || '') + ' · ' + (after.number || '') + ' · ' + (roleNames[after.role] || '') + (after.active ? '' : ' · Nieaktywne');
        for (const value of [new Date(entry.at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }), entry.actorName, { create: 'Dodanie konta', update: 'Zmiana konta', delete: 'Usunięcie konta' }[entry.action] || entry.action, details]) row.append(node('td', value));
        return row;
    });
    if (!rows.length) { const row = node('tr'), cell = node('td', 'Brak zmian kont.'); cell.colSpan = 4; row.append(cell); rows.push(row); }
    $('audit-rows').replaceChildren(...rows);
}
function renderPeople() {
    const search = $('search').value.toLocaleLowerCase('pl-PL');
    const rows = users.filter(user => (user.name + ' ' + user.number).toLocaleLowerCase('pl-PL').includes(search)).map(user => {
        const row = node('tr'), name = node('td', user.name), role = node('td'), actions = node('td');
        if (user.id === identity.employeeId) name.append(node('span', 'Twoje konto', 'muted'));
        role.append(node('span', roleNames[user.role], 'badge ' + user.role));
        const edit = node('button', 'Edytuj', 'secondary'); edit.addEventListener('click', () => editPerson(user));
        const toggle = node('button', user.active ? 'Zablokuj' : 'Aktywuj', 'secondary');
        toggle.disabled = user.id === identity.employeeId;
        toggle.addEventListener('click', () => perform(toggle, async () => {
            const version = usersVersion;
            if (!await confirmAction(user.active ? 'Zablokować konto?' : 'Aktywować konto?', user.name + ' · ' + user.number)) return;
            await request('userUpdate', {id:user.id,number:user.number,name:user.name,role:user.role,allowedStations:user.allowedStations,active:!user.active,version}); message('Zmieniono status konta.'); await loadUsers();
        }));
        const remove = node('button', 'Usuń', 'danger'); remove.disabled = user.id === identity.employeeId;
        remove.addEventListener('click', () => perform(remove, async () => {
            const version = usersVersion;
            if (!await confirmAction('Usunąć konto?', user.name + ' · ' + user.number + '. Dostęp zostanie odebrany. Konto i historia pozostaną w archiwum.')) return;
            await request('userDelete', { id: user.id, version }); message('Usunięto konto z aktywnej listy.'); await loadUsers();
        }));
        actions.append(edit, toggle, remove);
        row.append(name, node('td', user.number), role, node('td', user.active ? 'Aktywne' : 'Zablokowane', user.active ? 'status-active' : 'status-inactive'), actions);
        return row;
    });
    $('people-rows').replaceChildren(...rows); $('people-empty').hidden = Boolean(rows.length);
}
function editPerson(user) {
    $('person-form').reset(); editorVersion = usersVersion;
    $('person-title').textContent = user ? 'Edytuj osobę' : 'Dodaj osobę';
    $('person-id').value = user ? user.id : ''; $('person-number').value = user ? user.number : ''; $('person-name').value = user ? user.name : '';
    $('person-role').value = user ? user.role : 'employee'; $('person-active').checked = user ? user.active : true;
    const own = user && user.id === identity.employeeId;
    $('person-role').disabled = Boolean(own); $('person-active').disabled = Boolean(own);
    $('person-error').textContent = '';document.querySelectorAll('[name=allowed-station]').forEach(input=>{input.checked=!user||user.allowedStations.includes(input.value);}); $('person-dialog').showModal();
}
$('add-person').addEventListener('click', () => editPerson(null));
$('close-person').addEventListener('click', () => $('person-dialog').close());
let searchTimer; $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{userPage=1;loadUsers().catch(e=>message(e.message,true));},350);});
$('previous-page').addEventListener('click',()=>{userPage--;loadUsers().catch(e=>message(e.message,true));});
$('next-page').addEventListener('click',()=>{userPage++;loadUsers().catch(e=>message(e.message,true));});
$('refresh-people').addEventListener('click', event => perform(event.currentTarget, loadUsers));
$('person-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; $('person-error').textContent = '';
    try {
        const id = $('person-id').value;
        await request(id ? 'userUpdate' : 'userCreate', { ...(id?{id}:{}), allowedStations:[...document.querySelectorAll('[name=allowed-station]:checked')].map(input=>input.value), number: $('person-number').value.trim(), name: $('person-name').value.trim(), role: $('person-role').value, active: $('person-active').checked, version: editorVersion });
        $('person-dialog').close(); message('Zapisano konto pracownika.');
        if (identity) await loadUsers();
    } catch (error) { $('person-error').textContent = error.message; }
    finally { button.disabled = false; }
});

for(const [id,max] of [['plan-hour',24],['plan-minute',60]])for(let n=0;n<max;n++){const option=document.createElement('option');option.value=String(n).padStart(2,'0');option.textContent=option.value;$(id).append(option);}
HistoryPanel.init(request,()=>identity,message);

$('toggle-break-overlay').addEventListener('click',event=>perform(event.currentTarget,async()=>{if(!state)return;await request('setBreakOverlayDisabled',{disabled:!state.breakOverlayDisabled});message('Zapisano ustawienie nakładki przerwy.');}));
