'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FORMAT = 'andon-aes-256-gcm-v1';
function atomicWrite(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(tmp, file); } catch (error) { fs.unlinkSync(tmp); throw error; }
}
class Vault {
    constructor(key) {
        if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid encryption key.');
        this.key = key;
    }
    seal(value, scope) {
        const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(Buffer.from(FORMAT + ':' + scope));
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
        return JSON.stringify({ format: FORMAT, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
    }
    open(text, scope) {
        const envelope = JSON.parse(text);
        if (envelope.format !== FORMAT) throw new Error('Encrypted data required.');
        const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
        if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted envelope.');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
        decipher.setAAD(Buffer.from(FORMAT + ':' + scope)); decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
    }
    read(file, scope, allowLegacy = false) {
        if (!fs.existsSync(file)) return null;
        if (fs.statSync(file).size > 64 * 1024 * 1024) throw new Error('Data file too large.');
        const text = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(text);
        if (parsed.format === FORMAT) return this.open(text, scope);
        if (allowLegacy) return parsed;
        throw new Error('Unencrypted data rejected.');
    }
    write(file, value, scope) {
        // Kopia poprzedniej wersji również jest szyfrowana, nawet podczas migracji.
        if (fs.existsSync(file)) {
            const previous = fs.readFileSync(file, 'utf8');
            const parsed = JSON.parse(previous);
            const backup = parsed.format === FORMAT ? previous : this.seal(parsed, scope);
            atomicWrite(file + '.bak.enc', backup);
        }
        atomicWrite(file, this.seal(value, scope));
    }
    lookup(value) { return crypto.createHmac('sha256', this.key).update('employee-code:').update(value).digest('hex'); }
}
function loadKey(config) {
    if (config.masterKey) {
        if (!/^[A-Za-z0-9+/]{43}=$/.test(config.masterKey)) throw new Error('ANDON_MASTER_KEY musi być 32-bajtowym kluczem w base64.');
        return Buffer.from(config.masterKey, 'base64');
    }
    if (config.production && !config.keyFileExplicit) throw new Error('Produkcja wymaga zewnętrznego ANDON_MASTER_KEY lub ANDON_MASTER_KEY_FILE.');
    if (!fs.existsSync(config.keyFile)) {
        if (config.production) throw new Error('Nie znaleziono klucza szyfrowania.');
        if(config.historyFile&&fs.existsSync(config.historyFile))throw new Error('Brak klucza do bazy historii. Przywróć właściwy klucz.');
        const candidates = [config.accountsFile, config.stateFile];
        if (candidates.some(file => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(FORMAT))) throw new Error('Brak klucza do istniejących danych. Przywróć klucz; nie tworzę nowego.');
        fs.mkdirSync(path.dirname(config.keyFile), { recursive: true, mode: 0o700 });
        fs.writeFileSync(config.keyFile, crypto.randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
    }
    const key = Buffer.from(fs.readFileSync(config.keyFile, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error('Nieprawidłowy klucz szyfrowania.');
    return key;
}
module.exports = { Vault, loadKey, atomicWrite, FORMAT };
