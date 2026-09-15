'use strict';
const path = require('node:path');
const fs = require('node:fs');
const isWithin = (parent, child) => { const rel = path.relative(path.resolve(parent), path.resolve(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
function configFrom(env = process.env, root = path.resolve(__dirname, '..')) {
    const production = env.NODE_ENV === 'production';
    const dataDir = path.resolve(env.ANDON_DATA_DIR || path.join(root, 'data'));
    const cfg = {
        root, production, dataDir, accountsFile: path.join(dataDir, 'accounts.json'),
        historyFile:path.join(dataDir,'history.sqlite'),
        stateFile: path.resolve(env.ANDON_STATE_FILE || path.join(root, 'andon_state.json')),
        logsDir: path.resolve(env.ANDON_LOG_DIR || path.join(dataDir, 'logs')),
        keyFile: path.resolve(env.ANDON_MASTER_KEY_FILE || path.join(root, '.andon-keys', 'master.key')),
        keyFileExplicit: Boolean(env.ANDON_MASTER_KEY_FILE), masterKey: env.ANDON_MASTER_KEY,
        panelPath: env.ANDON_PANEL_PATH || '/panelsterowania', showPanelLink: env.ANDON_SHOW_PANEL_LINK !== 'false',
        host: env.ANDON_HOST || '127.0.0.1', port: Number(env.PORT || 3000),
        certFile: env.ANDON_TLS_CERT_FILE, tlsKeyFile: env.ANDON_TLS_KEY_FILE,
        origins: (env.ANDON_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean),
        proxy: env.ANDON_TRUST_PROXY ? env.ANDON_TRUST_PROXY.split(',').map(x => x.trim()).filter(Boolean) : false,
        allowedClients:(env.ANDON_ALLOWED_CLIENTS||'').split(',').map(v=>v.trim()).filter(Boolean),
        publicTestMode: env.ANDON_PUBLIC_TEST_MODE === 'true',
        webhook: String(env.DISCORD_WEBHOOK_URL || '').trim(),
        sessionTtl: 8 * 3600000, ownerIdle: 30 * 60000, employeeIdle: 60 * 60000
    };
    if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) throw new Error('Nieprawidłowy PORT.');
    if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(cfg.panelPath) || /^\/(api|socket\.io|client-config)(\/|$)/.test(cfg.panelPath)) throw new Error('Nieprawidłowy adres panelu.');
    for (const origin of cfg.origins) { const u = new URL(origin); if (u.origin !== origin || !['https:', 'http:'].includes(u.protocol) || production && u.protocol !== 'https:') throw new Error('Nieprawidłowa lista originów.'); }
    if (Boolean(cfg.certFile) !== Boolean(cfg.tlsKeyFile)) throw new Error('Podaj certyfikat i klucz TLS razem.');
    cfg.directTls = Boolean(cfg.certFile);
    cfg.secureCookies = production || cfg.directTls;
    if (env.ANDON_PUBLIC_TEST_MODE && !['true','false'].includes(env.ANDON_PUBLIC_TEST_MODE)) throw new Error('ANDON_PUBLIC_TEST_MODE przyjmuje wyłącznie true albo false.');
    if (cfg.publicTestMode && cfg.allowedClients.length) throw new Error('Tryb publicznego testu wymaga pustego ANDON_ALLOWED_CLIENTS. Wyłącz tryb testowy, aby użyć listy adresów.');
    if(production&&!cfg.allowedClients.length&&!cfg.publicTestMode)throw new Error('Produkcja wymaga ANDON_ALLOWED_CLIENTS: dozwolone adresy lub podsieci firmowe. Publiczny test wymaga jawnego ANDON_PUBLIC_TEST_MODE=true.');
    if(cfg.allowedClients.some(p=>['0.0.0.0/0','::/0','*'].includes(p)))throw new Error('Nie zezwalaj na wszystkie adresy klientów.');
    if (production && (!cfg.origins.length || (!cfg.directTls && !cfg.proxy))) throw new Error('Produkcja wymaga jawnych originów HTTPS i TLS lub zaufanego reverse proxy.');
    if (!production && !cfg.directTls && !['127.0.0.1', '::1', 'localhost'].includes(cfg.host)) throw new Error('HTTP w trybie lokalnym może nasłuchiwać wyłącznie na loopback. Dla sieci skonfiguruj TLS.');
    if (cfg.proxy && cfg.proxy.some(p => ['true', '*', '0.0.0.0/0', '::/0'].includes(p))) throw new Error('Podaj konkretne adresy lub podsieci zaufanego proxy.');
    for (const p of [cfg.dataDir, cfg.stateFile, cfg.logsDir, cfg.keyFile, cfg.tlsKeyFile].filter(Boolean)) if (isWithin(path.join(root, 'public'), p)) throw new Error('Dane, klucze i logi muszą być poza public/.');
    if (isWithin(dataDir, cfg.keyFile)) throw new Error('Klucz musi być przechowywany poza katalogiem danych.');
    if (production && !cfg.masterKey && isWithin(root, cfg.keyFile)) throw new Error('W produkcji plik klucza musi być poza katalogiem aplikacji.');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    return cfg;
}
module.exports = { configFrom, isWithin };
