'use strict';
process.env.TZ = 'Europe/Warsaw';
const path = require('node:path');
const root = __dirname;
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const { configFrom } = require('./lib/config');
const { createApplication } = require('./lib/server-app');
async function main() {
    const config = configFrom(process.env, root);
    const application = await createApplication(config);
    let address;try{address=await application.listen();}catch(error){await application.close();throw error;}
    console.log('[Andon] Serwer: ' + (config.directTls ? 'https' : 'http') + '://' + config.host + ':' + address.port);
    console.log('[Andon] Panel: ' + config.panelPath);
    if (!config.production) console.log('[Andon] Tryb lokalny. Firmowy dostęp wymaga konfiguracji HTTPS i ochrony klucza.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => application.close().then(() => process.exit(0)));
}
if (require.main === module) main().catch(error => { console.error('[Andon] Start przerwany. Sprawdź konfigurację, klucz i pliki danych.'); console.error('[Andon] ' + error.message.replace(/\b\d{8}\b/g, '[numer]')); process.exitCode = 1; });
module.exports = { createApplication };
