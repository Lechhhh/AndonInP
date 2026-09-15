'use strict';
const argon2 = require('argon2');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const { PublicError, denied } = require('./errors');
const { serial } = require('./security');
const {ids:stationIds}=require('../public/stations');
const STATIONS = stationIds();
const ROLES = Object.freeze({ owner: 'Właściciel', manager: 'Brygadzista', employee: 'Pracownik' });
const validCode = value => typeof value === 'string' && /^\d{8}$/.test(value);
const visible = user => {
    const { id, number, name, role, active, allowedStations } = user;
    return { id, number, name, role, active, allowedStations: [...allowedStations] };
};
class Accounts {
    constructor(file, vault) {
        this.file = file; this.vault = vault; this.exclusive = serial(); this.busyHashes = 0;
        this.hashOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, secret: createHmac('sha256', vault.key).update('argon2-pepper').digest() };
    }
    static async open(file, vault) {
        const store = new Accounts(file, vault);
        const saved = vault.read(file, 'accounts', true);
        if (saved && ![1, 2].includes(saved.schema)) throw new Error('Unsupported accounts schema.');
        if (!saved) {
            const at = new Date().toISOString();
            store.state = { schema: 2, version: 1, audit: [], users: [
                { id: randomUUID(), number: '10182672', name: 'Wiktor Filipowski', role: 'owner', active: true, createdAt: at, updatedAt: at },
                { id: randomUUID(), number: '10399071', name: 'Zwykły pracownik', role: 'employee', active: true, createdAt: at, updatedAt: at }
            ] };
        } else store.state = saved;
        store.validateBase();
        let changed = !saved || saved.schema === 1;
        for (const user of store.state.users) {
            if (!user.allowedStations) { user.allowedStations = [...STATIONS]; changed = true; }
            if (!Array.isArray(user.allowedStations) || user.allowedStations.some(s => !STATIONS.includes(s))) throw new Error('Invalid station assignments.');
            if (!user.codeHash) { if (saved && saved.schema === 2) throw new Error('Missing credential hash.'); user.codeHash = await argon2.hash(user.number, store.hashOptions); changed = true; }
            if (!/^\$argon2id\$v=19\$m=65536,(?:t=3,p=1|p=1,t=3)\$/.test(user.codeHash)) throw new Error('Invalid credential hash parameters.');
            user.lookup = vault.lookup(user.number);
        }
        store.state.schema = 2;
        store.dummyHash = await argon2.hash(randomBytes(32).toString('hex'), store.hashOptions);
        if (changed) store.persist(store.state);
        return store;
    }
    validateBase() {
        const state = this.state;
        if (!Number.isInteger(state.version) || !Array.isArray(state.users) || !Array.isArray(state.audit)) throw new Error('Invalid accounts data.');
        const numbers = new Set(), ids = new Set();
        for (const u of state.users) {
            if (!validCode(u.number) || !Object.hasOwn(ROLES, u.role) || typeof u.name !== 'string' || u.name.length > 100 || typeof u.active !== 'boolean' || typeof u.id !== 'string' || numbers.has(u.number) || ids.has(u.id)) throw new Error('Invalid or duplicate account.');
            numbers.add(u.number); ids.add(u.id);
        }
        if (!state.users.some(u => u.role === 'owner' && u.active && !u.deletedAt)) throw new Error('No active owner.');
    }
    persist(next) { this.vault.write(this.file, next, 'accounts'); }
    get(id) { return this.state.users.find(u => u.id === id && !u.deletedAt); }
    async authenticate(number) {
        if (this.busyHashes >= 2) throw new PublicError('BUSY', 'Serwer obsługuje inne logowania. Spróbuj za chwilę.', 429, 2);
        this.busyHashes++;
        try {
            const lookup = validCode(number) ? this.vault.lookup(number) : '';
            const user = this.state.users.find(u => u.lookup === lookup && u.active && !u.deletedAt);
            const valid = await argon2.verify(user ? user.codeHash : this.dummyHash, number, { secret: this.hashOptions.secret });
            const current = user && this.get(user.id);
            return valid && current === user && current.active ? current : undefined;
        } finally { this.busyHashes--; }
    }
    list(query = {}) {
        const { search = '', page = 1, limit = 25 } = query;
        const matched = this.state.users.filter(u => !u.deletedAt && (u.name + ' ' + u.number).toLocaleLowerCase('pl-PL').includes(search.toLocaleLowerCase('pl-PL')));
        return { version: this.state.version, users: matched.slice((page - 1) * limit, page * limit).map(visible), total: matched.length, page, limit,
            audit: this.state.audit.slice(-100).reverse().map(e => ({ id: e.id, at: e.at, actorName: e.actorName, action: e.action, userId: e.userId, after: e.after ? visible({ ...e.after, allowedStations: e.after.allowedStations || STATIONS }) : null })) };
    }
    mutate(actorId, action, data, authorize = () => {}) { return this.exclusive(async () => {
        authorize(); data=require('./validation').validate({create:'userCreate',update:'userUpdate',delete:'userDelete'}[action],data);
        const actor = this.get(actorId);
        if (!actor || !actor.active || actor.role !== 'owner') throw denied();
        if (data.version !== this.state.version) throw new PublicError('CONFLICT', 'Lista osób zmieniła się. Odśwież ją i otwórz formularz ponownie.', 409);
        const next = structuredClone(this.state), at = new Date().toISOString();
        let user = action === 'create' ? null : next.users.find(u => u.id === data.id && !u.deletedAt);
        const before = user ? visible(user) : null;
        if (action === 'create' || action === 'update') {
            if (action === 'update' && !user) throw new PublicError('NOT_FOUND', 'Nie znaleziono pracownika.', 404);
            if (next.users.some(u => u.number === data.number && u.id !== (user && user.id))) throw new PublicError('DUPLICATE', 'Ten numer jest już zajęty, również przez konto archiwalne.', 409);
            if (action === 'create') {
                if (next.users.length >= 10000) throw new PublicError('LIMIT', 'Osiągnięto limit kont.');
                user = { id: randomUUID(), createdAt: at }; next.users.push(user);
            }
            if (user.number !== data.number) user.codeHash = await argon2.hash(data.number, this.hashOptions);
            Object.assign(user, { number: data.number, lookup: this.vault.lookup(data.number), name: data.name, role: data.role, active: data.active, allowedStations: data.allowedStations, updatedAt: at });
        } else if (action === 'delete') {
            if (!user) throw new PublicError('NOT_FOUND', 'Nie znaleziono pracownika.', 404);
            Object.assign(user, { active: false, deletedAt: at, updatedAt: at });
        } else throw new PublicError('INVALID_OPERATION', 'Nieprawidłowa operacja.');
        if (user.id === actorId && (!user.active || user.role !== 'owner' || user.deletedAt)) throw new PublicError('SELF_LOCKOUT', 'Nie możesz odebrać dostępu własnemu kontu Właściciela.');
        if (!next.users.some(u => u.role === 'owner' && u.active && !u.deletedAt)) throw new PublicError('LAST_OWNER', 'Musi pozostać aktywny Właściciel.');
        next.version++;
        next.audit.push({ id: randomUUID(), at, actorId, actorName: actor.name, action, userId: user.id, before, after: visible(user) });
        next.audit=next.audit.slice(-10000); authorize(); this.persist(next); this.state = next;
        return { userId: user.id, version: next.version };
    }); }
}
module.exports = { Accounts, ROLES, STATIONS, validCode, visible };

