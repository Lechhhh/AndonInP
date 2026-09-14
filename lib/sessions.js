'use strict';
const crypto = require('node:crypto');
const cookie = require('cookie');
const { PublicError } = require('./errors');
const token = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
class Sessions {
    constructor(config, accounts, clock = Date.now) { this.config = config; this.accounts = accounts; this.clock = clock; this.items = new Map(); this.name = config.secureCookies ? '__Host-andon' : 'andon.local'; }
    sweep() { const now = this.clock(); for (const [key, s] of this.items) if (s.expires <= now || s.idleUntil <= now) this.items.delete(key); }
    from(req) {
        let raw; try { raw = cookie.parseCookie(req.headers.cookie || '')[this.name]; } catch { return null; }
        if (!raw || !/^[\w-]{43}$/.test(raw)) return null;
        return this.current(digest(raw));
    }
    current(key) {
        const s = this.items.get(key);
        if (!s || s.expires <= this.clock() || s.idleUntil <= this.clock()) { this.items.delete(key); return null; }
        if (s.userId) { const user = this.accounts.get(s.userId); if (!user || !user.active || user.updatedAt !== s.userVersion) { this.items.delete(key); return null; } }
        return s;
    }
    create(res, user) {
        this.sweep(); if (this.items.size >= 5000) throw new PublicError('BUSY', 'Serwer jest zajęty. Spróbuj ponownie później.', 503);
        const raw = token(), key = digest(raw), now = this.clock();
        const ttl = user ? this.config.sessionTtl : 10 * 60000;
        const idle = user ? (user.role === 'employee' ? this.config.employeeIdle : this.config.ownerIdle) : ttl;
        const session = { key, csrf: token(), userId: user ? user.id : null, userVersion: user ? user.updatedAt : null, expires: now + ttl, idleUntil: now + idle, idle };
        this.items.set(key, session);
        res.setHeader('Set-Cookie', cookie.stringifySetCookie({name:this.name,value:raw, httpOnly: true, secure: this.config.secureCookies, sameSite: 'strict', path: '/', maxAge: ttl / 1000 }));
        return session;
    }
    csrf(session, value) {
        if (!session || typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || !crypto.timingSafeEqual(Buffer.from(session.csrf), Buffer.from(value))) throw new PublicError('CSRF', 'Sesja formularza wygasła. Odśwież stronę.', 403);
    }
    touch(s) { s.idleUntil = Math.min(s.expires, this.clock() + s.idle); }
    remove(key) { this.items.delete(key); }
    revokeUser(id) { for (const [key, s] of this.items) if (s.userId === id) this.items.delete(key); }
    clearCookie(res) { res.setHeader('Set-Cookie', cookie.stringifySetCookie({name:this.name,value:'', httpOnly: true, secure: this.config.secureCookies, sameSite: 'strict', path: '/', maxAge: 0 })); }
}
module.exports = { Sessions };
