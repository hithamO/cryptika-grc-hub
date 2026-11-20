'use strict';
// Authentication (session cookie), tenant resolution and role-based permissions.
const crypto = require('node:crypto');
const { get, run, all } = require('./db');
const { HttpError, forbidden } = require('./lib/http');

const MODULES = ['governance', 'policies', 'frameworks', 'workflow', 'risk', 'compliance', 'audit', 'reports', 'admin'];
const LEVELS = { none: 0, view: 1, edit: 2, manage: 3 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(h, Buffer.from(hashHex, 'hex'));
}
function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  run('INSERT INTO sessions (token,user_id,tenant_id,expires_at) VALUES (?,?,?,?)', token, user.id, user.tenant_id, expires);
  return token;
}
// Set GRC_COOKIE_SECURE=1 when the application is served over HTTPS (always, outside a local trial).
// Where a request really comes from. A tunnel or reverse proxy on this computer connects from the loopback address and names the visitor in a header.
const isLoopback = a => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
function origin(req) {
  const socket = req.socket.remoteAddress; const forwarded = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const viaProxy = isLoopback(socket) && !!forwarded;
  return { address: viaProxy ? forwarded : socket, remote: viaProxy || !isLoopback(socket), https: process.env.GRC_COOKIE_SECURE === '1' || (viaProxy && /https/i.test(req.headers['x-forwarded-proto'] || '')) };
}
const cookie = (token, maxAge, secure = process.env.GRC_COOKIE_SECURE === '1') => `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

function loadUser(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = get('SELECT * FROM sessions WHERE token=?', m[1]);
  if (!s || s.expires_at < new Date().toISOString()) return null;
  const u = get(`SELECT u.id,u.tenant_id,u.email,u.name,u.role_id,u.department_id,u.job_title,u.is_platform_admin,u.active,
                 r.name role_name, r.level role_level, r.permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=?`, s.user_id);
  if (!u || !u.active) return null;
  u.permissions = u.permissions ? JSON.parse(u.permissions) : {};
  u.sessionToken = s.token;
  u.activeTenantId = s.tenant_id;  // platform admins may switch tenant
  return u;
}
// An organisation is active, read-only or suspended; a timed restriction lifts itself when its end time passes.
function tenantAccess(tenantId) {
  const t = get('SELECT status, access_until, access_reason FROM tenants WHERE id=?', tenantId); if (!t) return { status: 'suspended' };
  if (t.status !== 'active' && t.access_until && t.access_until <= new Date().toISOString()) {
    run(`UPDATE tenants SET status='active', access_until=NULL, access_reason=NULL WHERE id=?`, tenantId);
    run('INSERT INTO activity_log (tenant_id,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?)', tenantId, 'access.restored', 'tenant', tenantId, 'The restriction period ended');
    return { status: 'active' };
  }
  return { status: t.status, until: t.access_until || null, reason: t.access_reason || null };
}
const accessMessage = a => `This organisation's access is ${a.status === 'read_only' ? 'read-only' : 'suspended'}${a.until ? ' until ' + new Date(a.until).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}.${a.reason ? ' ' + a.reason : ''}`;
function can(user, module, level = 'view') {
  if (!user) return false;
  if (user.is_platform_admin) return true;
  return (LEVELS[user.permissions[module] || 'none'] || 0) >= LEVELS[level];
}
// Route guards
const authed = ctx => { if (!ctx.user) throw new HttpError(401, 'Please sign in'); };
const tenant = ctx => { authed(ctx); if (!ctx.tenantId) throw new HttpError(409, 'Select an organisation first'); };
const need = (module, level = 'view') => ctx => { tenant(ctx); if (!can(ctx.user, module, level)) throw forbidden(); };
const platform = ctx => { authed(ctx); if (!ctx.user.is_platform_admin) throw forbidden('Platform administrators only'); };
const usersWithRole = (tenantId, roleId) => all('SELECT id FROM users WHERE tenant_id=? AND role_id=? AND active=1', tenantId, roleId).map(r => r.id);

module.exports = { origin, tenantAccess, accessMessage, MODULES, LEVELS, hashPassword, verifyPassword, createSession, cookie, loadUser, can, authed, tenant, need, platform, usersWithRole };
