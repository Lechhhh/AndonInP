'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PublicError } = require('./errors');
class Limiter {
    constructor(maxKeys = 20000, clock = Date.now) { this.buckets = new Map(); this.maxKeys = maxKeys; this.clock = clock; }
    take(key, limit, windowMs) {
        const now = this.clock();
        let bucket = this.buckets.get(key);
        if (!bucket || bucket.end <= now) {
            if (this.buckets.size >= this.maxKeys) for (const [k, v] of this.buckets) if (v.end <= now) this.buckets.delete(k);
            if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) throw new PublicError('RATE_LIMIT', 'Serwer jest zajęty. Spróbuj ponownie później.', 429, 60);
            bucket = { count: 0, end: now + windowMs }; this.buckets.set(key, bucket);
        }
        if (++bucket.count > limit) throw new PublicError('RATE_LIMIT', 'Zbyt wiele prób. Odczekaj przed ponowieniem.', 429, Math.ceil((bucket.end - now) / 1000));
    }
}
class SecurityLog {
    constructor(dir, vault, secrets = []) { this.dir = dir; this.vault = vault; this.secrets = secrets.filter(Boolean); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
    redact(text) {
        let value = String(text);
        for (const secret of this.secrets) value = value.split(secret).join('[SECRET]');
        return value.replace(/\b\d{8}\b/g, '[EMPLOYEE_NUMBER]').replace(/https:\/\/[^\s"']*\/api\/webhooks\/[^\s"']*/g, '[WEBHOOK]');
    }
    write(event, detail = {}) {
        const id = crypto.randomUUID();
        const record = { id, at: new Date().toISOString(), event, ...detail };
        const sanitized = JSON.parse(this.redact(JSON.stringify(record))); sanitized.id=id;
        const file = path.join(this.dir, 'security.jsonl.enc');
        if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) {
            const oldest = file + '.5'; if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
            for (let i = 4; i >= 1; i--) if (fs.existsSync(file + '.' + i)) fs.renameSync(file + '.' + i, file + '.' + (i + 1));
            fs.renameSync(file, file + '.1');
        }
        fs.appendFileSync(file, this.vault.seal(sanitized, 'security-log') + '\n', { mode: 0o600 });
        return id;
    }
    error(error, context = {}) { return this.write('internal_error', { ...context, type: error.name, detail: this.redact(error.stack || error.message) }); }
}
function publicFailure(error, log, context) {
    if (error instanceof PublicError) {
        log.write('request_rejected', { ...context, code: error.code });
        return { ok: false, code: error.code, error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) };
    }
    const errorId = log.error(error, context);
    return { ok: false, code: 'INTERNAL_ERROR', error: 'Nie udało się wykonać operacji. Przekaż administratorowi numer zdarzenia: ' + errorId, errorId };
}
function serial() { let chain = Promise.resolve(); return fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result; }; }
module.exports = { Limiter, SecurityLog, publicFailure, serial };
