'use strict';
const { z } = require('zod');
const { PublicError } = require('./errors');
const { STATIONS } = require('./accounts');
const text = max => z.string().trim().min(1).max(max).refine(s => !/[\u0000-\u001f\u007f]/.test(s));
const id = z.uuid();
const person = z.object({ number: z.string().regex(/^\d{8}$/), name: text(100), role: z.enum(['employee', 'manager', 'owner']), active: z.boolean(), allowedStations: z.array(z.enum(STATIONS)).max(5).refine(v => new Set(v).size === v.length), version: z.number().int().positive() }).strict();
function parseDate(date, time) {
    const d = new Date(date + 'T' + time + ':00'); const pad = n => String(n).padStart(2, '0');
    if (!Number.isFinite(d.getTime()) || [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-') !== date || pad(d.getHours()) + ':' + pad(d.getMinutes()) !== time) return null;
    return d.getTime();
}
const historyQuery=z.object({period:z.enum(['day','week','month','undated']),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>parseDate(v,'12:00')!==null),station:z.enum(['all',...STATIONS]).default('all'),category:z.enum(['all','measurement','cycle','shift','support','settings','planner','break','downtime','notification','legacy']).default('all'),order:z.enum(['asc','desc']).default('desc'),page:z.number().int().min(1).max(100000).default(1),limit:z.number().int().min(1).max(200).default(50),watermark:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()}).strict();
const schemas = {historyQuery,historyExport:historyQuery,
    login: z.object({ code: z.string().regex(/^\d{8}$/) }).strict(),
    view: z.enum([...STATIONS, 'panel', 'tv']),
    usersList: z.object({ search: z.string().max(100).default(''), page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(100).default(25) }).strict(),
    userCreate: person, userUpdate: person.extend({ id }).strict(), userDelete: z.object({ id, version: z.number().int().positive() }).strict(),
    actionOK: z.object({ cycleId: id, requestId: id }).strict(),
    callSupport: z.object({ reason: z.enum(['Brak Materiału', 'Awaria Maszyny', 'Wada materiału', 'Inne / Brygadzista']), comment: z.string().trim().max(500).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)).default(''), requestId: id }).strict(),
    cancelSupport: z.object({ requestId: id }).strict(),
    adminSettings: z.object({ goal: z.number().int().min(1).max(10000), time: z.number().int().min(1).max(1440), requestId: id }).strict(),
    setBreakOverlayDisabled: z.object({ disabled: z.boolean(), requestId: id }).strict(),
    shiftStart: z.object({ requestId: id }).strict(), shiftStop: z.object({ requestId: id }).strict(),
    plannerAdd: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), requestId: id }).strict().refine(v => parseDate(v.date, v.time) !== null),
    plannerRemove: z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/), requestId: id }).strict(),
    logout: z.object({}).strict()
};
function validate(name, value) {
    const parsed = schemas[name].safeParse(value);
    if (!parsed.success) throw new PublicError('INVALID_INPUT', 'Nieprawidłowe dane. Sprawdź wymagane pola, format i dozwolone wartości.', 400);
    return parsed.data;
}
module.exports = { validate, parseDate };
