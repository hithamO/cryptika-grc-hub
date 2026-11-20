'use strict';
// Generic tenant-scoped CRUD for simple record types.
const { all, get, run, insert, update, nextRef, log } = require('../db');
const { need } = require('../auth');
const { bad, notFound } = require('../lib/http');

// Foreign keys a client may send, and the tenant-owned table each must point into.
const REF_TABLES = { department_id: 'departments', owner_id: 'users', user_id: 'users', lead_id: 'users', role_id: 'roles', process_id: 'business_processes', asset_id: 'assets', audit_id: 'audits', session_id: 'audit_sessions' };
// Copies the allowed fields from a request body. With ctx, also refuses ids that belong to another organisation.
const pick = (body, fields, ctx) => {
  const o = {};
  for (const f of fields) if (body[f] !== undefined) o[f] = body[f] === '' ? null : body[f];
  if (ctx) for (const [k, table] of Object.entries(REF_TABLES)) {
    if (o[k] != null && !get(`SELECT 1 x FROM ${table} WHERE id=? AND tenant_id=?`, o[k], ctx.t)) throw bad(`Unknown ${k.replace(/_id$/, '').replace(/_/g, ' ')}`);
  }
  return o;
};

function crud(router, base, table, { module, fields, required = [], refPrefix, listSql, orderBy = 'id DESC', editLevel = 'edit', onDelete }) {
  router.get(base, need(module), ctx => listSql ? all(listSql, ctx.t) : all(`SELECT * FROM ${table} WHERE tenant_id=? ORDER BY ${orderBy}`, ctx.t));
  router.post(base, need(module, editLevel), ctx => {
    const data = pick(ctx.body, fields, ctx);
    for (const r of required) if (!data[r]) throw bad(`"${r.replace(/_/g, ' ')}" is required`);
    data.tenant_id = ctx.t; if (refPrefix) data.ref = nextRef(ctx.t, refPrefix);
    const id = insert(table, data); log(ctx.t, ctx.user.id, 'create', table, id, data.name || data.title || data.ref || null);
    return get(`SELECT * FROM ${table} WHERE id=?`, id);
  });
  router.put(base + '/:id', need(module, editLevel), ctx => {
    const row = get(`SELECT id FROM ${table} WHERE id=? AND tenant_id=?`, ctx.params.id, ctx.t); if (!row) throw notFound();
    update(table, row.id, ctx.t, pick(ctx.body, fields, ctx)); log(ctx.t, ctx.user.id, 'update', table, row.id, null);
    return get(`SELECT * FROM ${table} WHERE id=?`, row.id);
  });
  router.delete(base + '/:id', need(module, editLevel), ctx => {
    const row = get(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`, ctx.params.id, ctx.t); if (!row) throw notFound();
    if (onDelete) onDelete(ctx, row);
    run(`DELETE FROM ${table} WHERE id=? AND tenant_id=?`, row.id, ctx.t); log(ctx.t, ctx.user.id, 'delete', table, row.id, row.name || row.title || row.ref || null);
  });
}
module.exports = { crud, pick };
