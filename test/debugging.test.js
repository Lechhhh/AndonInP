'use strict';
process.env.TZ = 'Europe/Warsaw';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { JSDOM } = require('jsdom');
const { Line } = require('../lib/line');
const { Vault } = require('../lib/vault');
const { configFrom } = require('../lib/config');
const { createApplication } = require('../lib/server-app');
const flush = () => new Promise(resolve => setImmediate(resolve));
const requestId = () => crypto.randomUUID();

function dashboard(t) {
    const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), {
        url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true
    });
    t.after(() => dom.window.close());
    const w = dom.window, socket = new EventEmitter(), errors = [];
    socket.connected = false;
    socket.disconnect = () => {
        if (!socket.connected) return;
        socket.connected = false;
        socket.emit('disconnect', 'io client disconnect');
    };
    w.addEventListener('error', event => errors.push(event.message));
    w.io = options => { socket.options = options; return socket; };
    w.fetch = async () => ({ json: async () => ({ panelPath: '/panelsterowania', showPanelLink: true }) });
    w.SupportSound = { reset() {}, sync() {} };
    w.AndonAuth = {
        async login() { return { userName: 'Operator testowy' }; },
        async connect() {
            socket.connected = true; socket.active = true; socket.emit('connect');
            socket.emit('sync', { shiftActive: true, isBreak: false, remainingSec: 60, downSec: 0,
                goal: 15, count: 0, cycleId: 'cycle-initial', logs: [], cycleTimes: [], serverTime: Date.now(),
                st: Object.fromEntries(['y0','y1','y2','y3','y4'].map(id => [id, { r: false, s: false }])) });
        },
        requestId
    };
    for (const file of ['stations.js', 'main.js']) {
        new vm.Script(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), { filename: file })
            .runInContext(dom.getInternalVMContext());
    }
    const click = selector => w.document.querySelector(selector).click();
    return { w, socket, errors, click, async login() {
        w.document.getElementById('password-input').value = '12345678';
        click('[data-event-click="0"]');
        await flush();
        assert.equal(socket.connected, true);
    } };
}

test('Dashboard: wielokrotny Enter nie rozpoczyna równoległych logowań', async t => {
    const { w, click } = dashboard(t);
    let calls = 0, resolve;
    w.AndonAuth.login = () => { calls++; return new Promise(done => { resolve = done; }); };
    const input = w.document.getElementById('password-input');
    input.value = '12345678';
    click('[data-event-click="0"]');
    input.dispatchEvent(new w.KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new w.KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true }));
    const count = calls;
    resolve({ userName: 'Operator testowy' });
    await flush();
    assert.equal(count, 1);
});

test('OK: zapis i przejście do następnego cyklu blokują ponowne kliknięcie', async t => {
    const f = dashboard(t), doc = f.w.document;
    let now = 0, sent = 0, ack;
    Object.defineProperty(f.w.performance, 'now', { value: () => now });
    f.socket.timeout = () => f.socket;
    f.socket.on('actionOK', (_data, callback) => { sent++; ack = callback; });
    await f.login();
    const button = doc.getElementById('btn-ok');
    const sync = (cycleId, ready = false) => f.socket.emit('sync', { shiftActive: true, isBreak: false,
        goal: 15, count: 0, remainingSec: 60, cycleId, st: { y0: { r: ready, s: false } } });
    button.click();
    assert.equal(sent, 1); assert.equal(button.disabled, true);
    sync('cycle-initial'); button.click();
    assert.equal(sent, 1); assert.match(button.textContent, /Zapisywanie/);
    ack(null, { ok: true });
    assert.equal(button.disabled, true);
    sync('cycle-initial', true);
    assert.match(button.textContent, /OCZEKIWANIE/);
    sync('cycle-next');
    assert.equal(button.disabled, true); assert.match(button.textContent, /Nowy cykl/);
    now = 1499; sync('cycle-next'); button.click(); assert.equal(sent, 1);
    now = 1501; sync('cycle-next');
    assert.equal(button.disabled, false);
    button.click(); assert.equal(sent, 2);
    ack(new Error('timeout'));
    assert.equal(button.disabled, false);
    assert.equal(doc.querySelector('.ok-wait-time'), null);
    assert.deepEqual(f.errors, []);
});

test('Logowanie: pilot i klawiatura wybierają stanowisko i przenoszą fokus', async t => {
    const f = dashboard(t), doc = f.w.document;
    await flush();
    const trigger = doc.querySelector('.custom-select-trigger');
    const press = key => doc.activeElement.dispatchEvent(new f.w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    trigger.focus(); press('ArrowDown');
    assert.equal(doc.activeElement.dataset.value, 'y1');
    press('End'); assert.equal(doc.activeElement.dataset.value, 'tv');
    press('ArrowUp'); assert.equal(doc.activeElement.dataset.value, 'y4');
    press('Enter');
    assert.equal(doc.getElementById('station-select').value, 'y4');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    doc.getElementById('password-input').focus(); press('ArrowDown');
    assert.equal(doc.activeElement, doc.querySelector('[data-auth-login]'));
    press('ArrowUp'); assert.equal(doc.activeElement.id, 'password-input');
    trigger.focus(); press('ArrowDown'); press('Escape');
    assert.equal(doc.activeElement, trigger); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(f.errors, []);
});

test('OK: wykonany plan pozostawia przycisk nieaktywny', async t => {
 const f=dashboard(t);await f.login();const button=f.w.document.getElementById('btn-ok');let sent=0;f.socket.on('actionOK',()=>sent++);
 f.socket.emit('sync',{shiftActive:false,goal:8,count:8,cycleId:'finished',st:{y0:{r:false,s:false}}});
 assert.equal(button.disabled,true);assert.match(button.textContent,/CEL OSIĄGNIĘTY/);button.click();assert.equal(sent,0);
});

for (const event of ['disconnect', 'sessionRevoked']) {
    test('Dashboard: ' + event + ' zamyka okna i czyści komentarz wezwania', async t => {
        const f = dashboard(t), doc = f.w.document;
        await f.login();
        f.click('[data-event-click="12"]');
        doc.getElementById('support-comment').value = 'Komentarz poprzedniego operatora';
        assert(doc.getElementById('modal-support').classList.contains('show'));
        if (event === 'disconnect') f.socket.disconnect();
        else f.socket.emit('sessionRevoked', { error: 'Sesja wygasła.' });
        assert.equal(doc.querySelectorAll('.modal-overlay.show').length, 0);
        assert.equal(doc.getElementById('support-comment').value, '');
        assert.equal(doc.getElementById('view-login').classList.contains('hidden'), false);
        assert.deepEqual(f.errors, []);
    });
}

test('Dashboard: zakończenie sesji zamyka Opcje i przywraca inert', async t => {
    const f = dashboard(t), doc = f.w.document;
    await f.login();
    f.click('[data-event-click="7"]');
    assert(doc.getElementById('modal-op-settings').classList.contains('show'));
    f.socket.disconnect();
    assert.equal(doc.getElementById('modal-op-settings').classList.contains('show'), false);
    assert.equal(doc.getElementById('modal-op-settings').inert, true);
});

for (const reason of ['transport close', 'transport error', 'ping timeout']) {
    test('Dashboard: ' + reason + ' zachowuje widok i wznawia dane bez logowania', async t => {
        const f = dashboard(t), doc = f.w.document;
        await f.login();
        f.click('[data-event-click="12"]');
        doc.getElementById('support-comment').value = 'Potrzebny materiał';
        f.socket.connected = false;
        f.socket.emit('disconnect', reason);
        assert.equal(doc.getElementById('view-login').classList.contains('hidden'), true);
        assert.equal(doc.getElementById('view-op').classList.contains('hidden'), false);
        assert.equal(doc.getElementById('btn-ok').disabled, true);
        assert.equal(doc.getElementById('btn-help').disabled, true);
        assert.equal(doc.getElementById('support-comment').value, 'Potrzebny materiał');
        assert.equal(f.socket.options.reconnection, true);
        let sent = 0;
        f.socket.on('callSupport', () => sent++);
        f.click('[data-event-click="21"]');
        assert.equal(sent, 0);
        f.socket.connected = true;
        f.socket.emit('connect');
        f.socket.emit('sync', { shiftActive: true, isBreak: false, remainingSec: 60, downSec: 0,
            goal: 15, count: 2, cycleId: 'cycle-initial', st: { y0: { r: false, s: false } } });
        assert.equal(doc.getElementById('btn-ok').disabled, false);
        assert.equal(doc.getElementById('connection-banner').classList.contains('hidden'), true);
        assert.equal(doc.getElementById('view-op').classList.contains('hidden'), false);
        assert.deepEqual(f.errors, []);
    });
}

test('Dashboard: błąd sieci zachowuje sesję, odmowa serwera wymaga logowania', async t => {
    const f = dashboard(t), doc = f.w.document;
    await f.login();
    f.socket.connected = false;
    f.socket.emit('disconnect', 'transport close');
    f.socket.emit('connect_error', new Error('Network unavailable'));
    assert.equal(doc.getElementById('view-login').classList.contains('hidden'), true);
    f.socket.emit('connect_error', Object.assign(new Error('Denied'), { data: { code: 'CSRF' } }));
    assert.equal(doc.getElementById('view-login').classList.contains('hidden'), false);
});

test('Dashboard TV: czasy wykonania trafiają do widoku bez danych osobowych', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andon-debug-line-'));
    const line = new Line(path.join(dir, 'state.json'), new Vault(crypto.randomBytes(32)));
    let now = new Date('2026-09-13T07:00:00+02:00').getTime();
    line.clock = () => now;
    const user = { id: requestId(), name: 'Operator testowy', role: 'owner' };
    line.change('shiftStart', { requestId: requestId() }, user, 'panel');
    now += 60000;
    line.change('actionOK', { cycleId: line.state.cycleId, requestId: requestId() }, user, 'y0');
    const snapshot = line.snapshot('tv', user);
    assert.equal(snapshot.cycleTimes.length, 1);
    assert.equal(snapshot.cycleTimes[0].netSeconds, 60);
    assert.equal(Object.hasOwn(snapshot.cycleTimes[0], 'employeeId'), false);
    assert.equal(line.snapshot('y0', user).cycleTimes.length, 0);
    const f = dashboard(t);
    f.w.document.getElementById('station-select').value = 'tv';
    await f.login();
    f.socket.emit('sync', snapshot);
    f.click('[data-event-click="6"]');
    const logs = f.w.document.getElementById('tv-cycle-logs');
    assert.equal(logs.classList.contains('hidden'), false);
    assert.equal(logs.children.length, 1);
    assert.match(logs.textContent, /X0.*1m 0s/);
    assert.deepEqual(f.errors, []);
});

test('Logowanie HTTP: wylogowanie podczas weryfikacji kodu nie odtwarza sesji', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andon-debug-auth-'));
    const config = configFrom({ PORT: '0', ANDON_DATA_DIR: path.join(dir, 'data'),
        ANDON_STATE_FILE: path.join(dir, 'state.json'), ANDON_MASTER_KEY: crypto.randomBytes(32).toString('base64')
    }, path.resolve(__dirname, '..'));
    const application = await createApplication(config);
    t.after(() => application.close());
    const address = await application.listen(), url = 'http://127.0.0.1:' + address.port;
    config.origins = [url];
    const session = await fetch(url + '/api/session', { headers: { Origin: url } });
    const { csrfToken } = await session.json();
    const headers = { Origin: url, Cookie: session.headers.get('set-cookie').split(';')[0],
        'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
    let release, started;
    const verifying = new Promise(resolve => { started = resolve; });
    application.accounts.authenticate = async () => {
        started();
        await new Promise(resolve => { release = resolve; });
        return application.accounts.state.users[0];
    };
    const login = fetch(url + '/api/login', { method: 'POST', headers, body: JSON.stringify({ code: '12345678' }) });
    await verifying;
    const logout = await fetch(url + '/api/logout', { method: 'POST', headers, body: '{}' });
    release();
    const response = await login;
    assert.equal(logout.status, 200);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(application.sessions.items.size, 0);
});
