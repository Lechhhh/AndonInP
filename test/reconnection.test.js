'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { io } = require('socket.io-client');
const { configFrom } = require('../lib/config');
const { createApplication } = require('../lib/server-app');

async function until(predicate) {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Nie osiągnięto oczekiwanego stanu połączenia.');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

for (const view of ['dashboard', 'panel']) {
    test(view + ': prawdziwe ponowne połączenie zachowuje sesję, nieważna sesja jest odrzucana', async t => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andon-reconnect-'));
        const config = configFrom({ PORT: '0', ANDON_DATA_DIR: path.join(dir, 'data'),
            ANDON_STATE_FILE: path.join(dir, 'state.json'), ANDON_MASTER_KEY: crypto.randomBytes(32).toString('base64')
        }, path.resolve(__dirname, '..'));
        const application = await createApplication(config);
        let dom, socket;
        t.after(async () => { socket?.disconnect(); dom?.window.close(); await application.close(); });
        const address = await application.listen(), url = 'http://127.0.0.1:' + address.port;
        config.origins = [url];
        const isPanel = view === 'panel';
        dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../public', isPanel ? 'control-panel.html' : 'index.html'), 'utf8'), {
            url, runScripts: 'outside-only', pretendToBeVisual: true
        });
        const w = dom.window, doc = w.document, errors = [], headers = { Origin: url };
        w.addEventListener('error', event => errors.push(event.message));
        w.AbortSignal = AbortSignal;
        w.HTMLDialogElement.prototype.close = function () { this.open = false; };
        w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        w.fetch = async (route, options = {}) => {
            const response = await fetch(new URL(route, url), { ...options, headers: { ...headers, ...options.headers } });
            const cookie = response.headers.get('set-cookie');
            if (cookie) headers.Cookie = cookie.split(';')[0];
            return response;
        };
        let syncCount = 0, loginCount = 0;
        const authenticate = application.accounts.authenticate.bind(application.accounts);
        application.accounts.authenticate = async code => { loginCount++; return authenticate(code); };
        w.io = options => {
            socket = io(url, { ...options, transports: ['websocket'], extraHeaders: headers,
                reconnectionDelay: 100, reconnectionDelayMax: 100, randomizationFactor: 0 });
            socket.on('sync', () => syncCount++);
            return socket;
        };
        const files = ['auth-client.js', 'stations.js', 'support-sound.js',
            ...(isPanel ? ['exporter.js', 'history-panel.js', 'control-panel.js'] : ['main.js'])];
        for (const file of files) new vm.Script(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), { filename: file })
            .runInContext(dom.getInternalVMContext());
        const owner = application.accounts.state.users[0];
        doc.getElementById(isPanel ? 'access-code' : 'password-input').value = owner.number;
        if (isPanel) doc.getElementById('login-form').dispatchEvent(new w.SubmitEvent('submit', {
            bubbles: true, cancelable: true, submitter: doc.querySelector('#login-form button')
        }));
        else doc.querySelector('[data-event-click="0"]').click();
        await until(() => socket.connected && syncCount > 0 && !doc.querySelector(isPanel ? '#login-form button' : '[data-event-click="0"]').disabled);
        const loggedIn = () => isPanel ? !doc.getElementById('workspace').hidden : doc.getElementById('view-login').classList.contains('hidden');
        assert.equal(loggedIn(), true);
        assert.equal(socket.io.reconnection(), true);
        if (isPanel) doc.getElementById('goal').value = '29';

        // Going to another tab alone must not change authentication or the selected view.
        let hidden = true;
        Object.defineProperty(doc, 'hidden', { configurable: true, get: () => hidden });
        doc.dispatchEvent(new w.Event('visibilitychange'));
        assert.equal(loggedIn(), true);
        const previousId = socket.id, previousSyncs = syncCount;
        application.io.sockets.sockets.get(previousId).conn.close();
        await until(() => !socket.connected);
        assert.equal(loggedIn(), true);
        if (isPanel) assert.equal(doc.getElementById('start-shift').disabled, true);
        else assert.equal(doc.getElementById('btn-ok').disabled, true);
        hidden = false;
        doc.dispatchEvent(new w.Event('visibilitychange'));
        await until(() => socket.connected && socket.id !== previousId && syncCount > previousSyncs);
        assert.equal(loggedIn(), true);
        assert.equal(loginCount, 1);
        assert.equal(application.sessions.items.size, 1);
        if (isPanel) {
            assert.equal(doc.getElementById('goal').value, '29');
            assert.equal(doc.getElementById('start-shift').disabled, false);
            assert.equal(doc.getElementById('connection').hidden, true);
        } else assert.equal(doc.getElementById('connection-banner').classList.contains('hidden'), true);

        // The next reconnect must fail if the session was revoked or expired while offline.
        application.io.sockets.sockets.get(socket.id).conn.close();
        await until(() => !socket.connected);
        if (isPanel) application.sessions.revokeUser(owner.id);
        else for (const session of application.sessions.items.values()) session.idleUntil = 0;
        await until(() => !loggedIn());
        assert.equal(socket.connected, false);
        assert.equal(socket.active, false);
        assert.equal(loginCount, 1);
        assert.deepEqual(errors, []);
    });
}
