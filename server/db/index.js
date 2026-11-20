'use strict';
// Database access layer. One SQLite file; all SQL goes through these helpers.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.GRC_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'grc.db');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
// Additive migrations for databases created by an earlier version (columns are only ever added, never changed).
for (const [table, column, type] of [
  ['vuln_categories', 'tenant_id', 'INTEGER'],        // an organisation may bring its own vulnerability categories
  ['tenants', 'access_until', 'TEXT'],                // when a suspension or read-only period ends (empty = until changed)
  ['tenants', 'access_reason', 'TEXT'],
  ['tenants', 'user_limit', 'INTEGER'],
]) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);

const cache = new Map();
const stmt = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
const norm = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const all = (sql, ...p) => stmt(sql).all(...norm(p));
const get = (sql, ...p) => stmt(sql).get(...norm(p));
const run = (sql, ...p) => stmt(sql).run(...norm(p));
const insert = (table, obj) => {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => obj[k]));
  return Number(r.lastInsertRowid);
};
const update = (table, id, tenantId, obj) => {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map(k => k + '=?').join(',')} WHERE id=? AND tenant_id=?`, ...keys.map(k => obj[k]), id, tenantId);
};
let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN'); depth++;
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; }
}
// Human-readable reference numbers per tenant: POL-0001, RSK-0001 …
function nextRef(tenantId, prefix) {
  run('INSERT INTO counters (tenant_id, key, value) VALUES (?,?,1) ON CONFLICT(tenant_id, key) DO UPDATE SET value = value + 1', tenantId, prefix);
  const { value } = get('SELECT value FROM counters WHERE tenant_id=? AND key=?', tenantId, prefix);
  return `${prefix}-${String(value).padStart(4, '0')}`;
}
const meta = {
  get: k => get('SELECT value FROM meta WHERE key=?', k)?.value,
  set: (k, v) => run('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v)),
};
const log = (tenantId, userId, action, entityType, entityId, detail) =>
  run('INSERT INTO activity_log (tenant_id,user_id,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?,?)', tenantId, userId, action, entityType, entityId, detail);
function notify(tenantId, userIds, title, body, link) {
  for (const uid of new Set(userIds)) run('INSERT INTO notifications (tenant_id,user_id,title,body,link) VALUES (?,?,?,?,?)', tenantId, uid, title, body, link);
}
// IN (...) helper for id lists
const inList = ids => ids.length ? ids.map(n => Number(n)).filter(Number.isFinite).join(',') : 'NULL';

module.exports = { db, all, get, run, insert, update, tx, nextRef, meta, log, notify, inList, DATA_DIR, DB_FILE };
