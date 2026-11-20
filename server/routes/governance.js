'use strict';
// Governance: company profile, governing laws & regulations, business processes, committees, policies.
const { all, get, run, insert, update, tx, nextRef, log, notify, inList } = require('../db');
const { tenant, need, can } = require('../auth');
const { bad, notFound, forbidden } = require('../lib/http');
const { crud, pick } = require('./_crud');
const workflow = require('../services/workflow');
const { filterControlIds } = require('./library');

// Applies the platform's applicability rules to the tenant's profile: mandatory frameworks are added automatically.
function syncMandatory(tenantId, userId) {
  const p = get('SELECT sector, country FROM company_profile WHERE tenant_id=?', tenantId) || {};
  const rules = all(`SELECT r.*, f.id framework_id FROM regulatory_rules r JOIN frameworks f ON f.code=r.framework_code AND f.tenant_id IS NULL
                     WHERE r.country IN (?, '*') AND r.sector IN (?, '*')`, p.country || '', p.sector || '');
  const mandatory = new Map(); const recommended = new Map();
  for (const r of rules) (r.requirement === 'mandatory' ? mandatory : recommended).set(r.framework_id, r.basis);
  tx(() => {
    for (const [fid, basis] of mandatory)
      run(`INSERT INTO tenant_frameworks (tenant_id,framework_id,requirement,basis,added_by) VALUES (?,?,?,?,?)
           ON CONFLICT(tenant_id,framework_id) DO UPDATE SET requirement='mandatory', basis=excluded.basis`, tenantId, fid, 'mandatory', basis, userId);
    // a framework that is no longer mandatory for the new profile stays adopted, as a voluntary choice
    for (const row of all(`SELECT framework_id FROM tenant_frameworks WHERE tenant_id=? AND requirement='mandatory'`, tenantId))
      if (!mandatory.has(row.framework_id)) run(`UPDATE tenant_frameworks SET requirement='voluntary' WHERE tenant_id=? AND framework_id=?`, tenantId, row.framework_id);
  });
  for (const fid of mandatory.keys()) recommended.delete(fid);
  return { mandatory, recommended };
}

function policyAccess(ctx, p) {
  const u = ctx.user; const manage = can(u, 'policies', 'manage'); const edit = can(u, 'policies', 'edit');
  const turn = p.status === 'in_review' && workflow.isCurrentApprover(ctx.t, u, 'policy', p.id);
  return {
    can_edit: (['draft', 'rejected'].includes(p.status) && edit && (p.created_by === u.id || manage)) || turn,
    can_submit: ['draft', 'rejected'].includes(p.status) && edit && (p.created_by === u.id || manage),
    can_decide: turn || (p.status === 'in_review' && can(u, 'admin', 'manage')),
    can_print: p.status === 'published',
    can_revise: p.status === 'published' && edit,
    can_delete: ['draft', 'rejected'].includes(p.status) && (p.created_by === u.id || manage),
  };
}
function loadPolicy(ctx, id) {
  const p = get(`SELECT p.*, u.name owner_name, cb.name author_name, f.code driver_framework FROM policies p LEFT JOIN users u ON u.id=p.owner_id
                 LEFT JOIN users cb ON cb.id=p.created_by LEFT JOIN frameworks f ON f.id=p.driver_framework_id WHERE p.id=? AND p.tenant_id=?`, id, ctx.t);
  if (!p) throw notFound('Policy not found');
  const ctl = 'c.id, c.ref, c.title, f.code framework';
  p.driver_controls = all(`SELECT ${ctl} FROM policy_driver_controls d JOIN controls c ON c.id=d.control_id JOIN frameworks f ON f.id=c.framework_id WHERE d.policy_id=?`, p.id);
  p.clauses = all('SELECT id, number, text FROM policy_clauses WHERE policy_id=? ORDER BY sort, id', p.id);
  const cc = p.clauses.length ? all(`SELECT cc.clause_id, ${ctl} FROM clause_controls cc JOIN controls c ON c.id=cc.control_id JOIN frameworks f ON f.id=c.framework_id WHERE cc.clause_id IN (${inList(p.clauses.map(c => c.id))})`) : [];
  for (const c of p.clauses) c.controls = cc.filter(x => x.clause_id === c.id).map(({ clause_id, ...rest }) => rest);
  p.workflow = workflow.forEntity(ctx.t, 'policy', p.id);
  p.access = policyAccess(ctx, p);
  return p;
}
function savePolicyBody(ctx, id, b) {
  if (b.driver_control_ids) {
    run('DELETE FROM policy_driver_controls WHERE policy_id=?', id);
    for (const cid of filterControlIds(ctx, b.driver_control_ids)) run('INSERT INTO policy_driver_controls (policy_id, control_id) VALUES (?,?)', id, cid);
  }
  if (Array.isArray(b.clauses)) {
    run('DELETE FROM policy_clauses WHERE policy_id=?', id);
    b.clauses.forEach((c, i) => {
      if (!String(c.text || '').trim()) return;
      const cid = insert('policy_clauses', { policy_id: id, number: c.number || String(i + 1), text: String(c.text).trim(), sort: i });
      for (const k of filterControlIds(ctx, c.control_ids)) run('INSERT INTO clause_controls (clause_id, control_id) VALUES (?,?)', cid, k);
    });
  }
}
const POLICY_FIELDS = ['title', 'doc_type', 'category', 'version', 'owner_id', 'purpose', 'scope', 'summary', 'driver_framework_id', 'review_date'];

workflow.register('policy', {
  label: 'Policy', link: id => `#/policies/${id}`,
  onApproved(tenantId, id) {
    const p = get('SELECT * FROM policies WHERE id=?', id);
    run(`UPDATE policies SET status='published', published_at=datetime('now') WHERE id=?`, id);
    if (p.supersedes_id) run(`UPDATE policies SET status='retired' WHERE id=? AND tenant_id=?`, p.supersedes_id, tenantId);
    notify(tenantId, all('SELECT id FROM users WHERE tenant_id=? AND active=1', tenantId).map(u => u.id), `Published: ${p.title}`, `${p.doc_type} ${p.ref} v${p.version} is now in force`, `#/policies/${id}`);
  },
  onRejected(tenantId, id) { run(`UPDATE policies SET status='rejected' WHERE id=?`, id); },
});

module.exports = router => {
  // Company profile
  router.get('/governance/profile', tenant, ctx => get('SELECT * FROM company_profile WHERE tenant_id=?', ctx.t) || {});
  router.put('/governance/profile', need('governance', 'edit'), ctx => {
    const d = pick(ctx.body, ['legal_name', 'sector', 'country', 'size', 'description', 'mission', 'vision', 'business_objectives', 'cyber_objectives'], ctx);
    const keys = Object.keys(d);
    run(`INSERT INTO company_profile (tenant_id) VALUES (?) ON CONFLICT(tenant_id) DO NOTHING`, ctx.t);
    if (keys.length) run(`UPDATE company_profile SET ${keys.map(k => k + '=?').join(',')}, updated_at=datetime('now') WHERE tenant_id=?`, ...keys.map(k => d[k]), ctx.t);
    const { mandatory } = syncMandatory(ctx.t, ctx.user.id);
    log(ctx.t, ctx.user.id, 'update', 'company_profile', null, null);
    return { ...get('SELECT * FROM company_profile WHERE tenant_id=?', ctx.t), mandatory_frameworks: mandatory.size };
  });

  // Governing laws & regulations
  router.get('/governance/regulations', tenant, ctx => {
    const { recommended } = syncMandatory(ctx.t, ctx.user.id);
    const adopted = all(`SELECT f.id, f.code, f.name, f.library, f.region, f.tenant_id, tf.requirement, tf.basis, tf.added_at,
        (SELECT count(*) FROM controls c WHERE c.framework_id=f.id AND c.assessable=1) controls
      FROM tenant_frameworks tf JOIN frameworks f ON f.id=tf.framework_id WHERE tf.tenant_id=? ORDER BY (tf.requirement='mandatory') DESC, f.library, f.sort`, ctx.t);
    const have = new Set(adopted.map(a => a.id));
    const available = all(`SELECT f.id, f.code, f.name, f.library, f.region, (SELECT count(*) FROM controls c WHERE c.framework_id=f.id AND c.assessable=1) controls
      FROM frameworks f WHERE f.tenant_id IS NULL ORDER BY f.library, f.sort`).filter(f => !have.has(f.id)).map(f => ({ ...f, recommended: recommended.has(f.id), basis: recommended.get(f.id) || null }));
    return { profile: get('SELECT sector, country FROM company_profile WHERE tenant_id=?', ctx.t), adopted, available };
  });
  router.post('/governance/regulations', need('governance', 'edit'), ctx => {
    const f = get('SELECT id, code FROM frameworks WHERE id=? AND (tenant_id IS NULL OR tenant_id=?)', ctx.body.framework_id, ctx.t); if (!f) throw notFound();
    run(`INSERT INTO tenant_frameworks (tenant_id,framework_id,requirement,basis,added_by) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`, ctx.t, f.id, 'voluntary', ctx.body.basis || 'Voluntary adoption', ctx.user.id);
    log(ctx.t, ctx.user.id, 'framework.adopt', 'framework', f.id, f.code);
  });
  router.delete('/governance/regulations/:id', need('governance', 'edit'), ctx => {
    const row = get('SELECT * FROM tenant_frameworks WHERE tenant_id=? AND framework_id=?', ctx.t, ctx.params.id); if (!row) throw notFound();
    if (row.requirement === 'mandatory') throw bad('This framework is mandatory for your sector and country and cannot be removed');
    run('DELETE FROM tenant_frameworks WHERE tenant_id=? AND framework_id=?', ctx.t, ctx.params.id);
    log(ctx.t, ctx.user.id, 'framework.remove', 'framework', Number(ctx.params.id), null);
  });

  crud(router, '/governance/processes', 'business_processes', { module: 'governance', fields: ['name', 'description', 'owner', 'department_id', 'criticality'], required: ['name'], refPrefix: 'BP',
    listSql: `SELECT b.*, d.name department FROM business_processes b LEFT JOIN departments d ON d.id=b.department_id WHERE b.tenant_id=? ORDER BY b.id` });

  router.get('/governance/committees', need('governance'), ctx => {
    const cs = all('SELECT * FROM committees WHERE tenant_id=? ORDER BY id', ctx.t);
    const ms = all(`SELECT m.*, u.name user_name, r.name role_name FROM committee_members m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN roles r ON r.id=u.role_id WHERE m.tenant_id=? ORDER BY m.id`, ctx.t);
    return cs.map(c => ({ ...c, members: ms.filter(m => m.committee_id === c.id) }));
  });
  router.post('/governance/committees', need('governance', 'edit'), ctx => { if (!ctx.body.name) throw bad('Committee name is required'); return { id: insert('committees', { tenant_id: ctx.t, ...pick(ctx.body, ['name', 'purpose', 'meeting_frequency'], ctx) }) }; });
  router.put('/governance/committees/:id', need('governance', 'edit'), ctx => { update('committees', ctx.params.id, ctx.t, pick(ctx.body, ['name', 'purpose', 'meeting_frequency'], ctx)); });
  router.delete('/governance/committees/:id', need('governance', 'edit'), ctx => { run('DELETE FROM committees WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });
  router.post('/governance/committees/:id/members', need('governance', 'edit'), ctx => {
    if (!get('SELECT 1 x FROM committees WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t)) throw notFound();
    if (!ctx.body.user_id && !ctx.body.name) throw bad('Choose a person or type a name');
    return { id: insert('committee_members', { tenant_id: ctx.t, committee_id: Number(ctx.params.id), ...pick(ctx.body, ['user_id', 'name', 'title', 'committee_role'], ctx) }) };
  });
  router.delete('/governance/committee-members/:id', need('governance', 'edit'), ctx => { run('DELETE FROM committee_members WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });

  // ── Policies ──
  router.get('/policies', need('policies'), ctx => all(`SELECT p.id,p.ref,p.title,p.doc_type,p.category,p.version,p.status,p.source,p.review_date,p.published_at,p.updated_at,p.created_by,
      u.name owner_name, f.code driver_framework,
      (SELECT count(*) FROM policy_clauses pc WHERE pc.policy_id=p.id) clauses,
      (SELECT count(DISTINCT cc.control_id) FROM clause_controls cc JOIN policy_clauses pc ON pc.id=cc.clause_id WHERE pc.policy_id=p.id) mapped_controls,
      (SELECT stages FROM workflow_instances w WHERE w.entity_type='policy' AND w.entity_id=p.id AND w.status='in_progress') wf_stages,
      (SELECT stage_index FROM workflow_instances w WHERE w.entity_type='policy' AND w.entity_id=p.id AND w.status='in_progress') wf_index
    FROM policies p LEFT JOIN users u ON u.id=p.owner_id LEFT JOIN frameworks f ON f.id=p.driver_framework_id WHERE p.tenant_id=? ORDER BY p.id DESC`, ctx.t)
    .map(p => { const st = p.wf_stages ? JSON.parse(p.wf_stages)[p.wf_index] : null; delete p.wf_stages; delete p.wf_index; return { ...p, stage: st ? st.name : null }; }));
  router.get('/policies/:id', need('policies'), ctx => loadPolicy(ctx, ctx.params.id));
  router.post('/policies', need('policies', 'edit'), ctx => {
    const b = ctx.body; if (!String(b.title || '').trim()) throw bad('Give the policy a title');
    const imported = b.source === 'imported';
    if (imported && !can(ctx.user, 'policies', 'manage')) throw forbidden('Only a policy manager can register an already-approved policy');
    return tx(() => {
      const id = insert('policies', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'POL'), ...pick(b, POLICY_FIELDS, ctx), status: imported ? 'published' : 'draft', source: imported ? 'imported' : 'authored',
        created_by: ctx.user.id, updated_at: new Date().toISOString(), published_at: imported ? new Date().toISOString() : null });
      savePolicyBody(ctx, id, b);
      log(ctx.t, ctx.user.id, imported ? 'policy.import' : 'create', 'policy', id, b.title);
      return { id };
    });
  });
  router.put('/policies/:id', need('policies'), ctx => {
    const p = loadPolicy(ctx, ctx.params.id); if (!p.access.can_edit) throw forbidden(p.status === 'published' ? 'A published policy cannot be changed. Start a new version instead.' : 'This policy is with another approver and cannot be edited now');
    tx(() => { update('policies', p.id, ctx.t, { ...pick(ctx.body, POLICY_FIELDS, ctx), updated_at: new Date().toISOString() }); savePolicyBody(ctx, p.id, ctx.body); });
    log(ctx.t, ctx.user.id, 'update', 'policy', p.id, null);
    return { id: p.id };
  });
  router.post('/policies/:id/submit', need('policies', 'edit'), ctx => {
    const p = loadPolicy(ctx, ctx.params.id); if (!p.access.can_submit) throw forbidden('Only the author can send this policy for approval');
    if (!p.clauses.length) throw bad('Add at least one clause before sending the policy for approval');
    return tx(() => { run(`UPDATE policies SET status='in_review' WHERE id=?`, p.id); return workflow.start(ctx.t, ctx.user, 'policy', p.id, `${p.ref} ${p.title}`); });
  });
  router.post('/policies/:id/revise', need('policies', 'edit'), ctx => {
    const p = loadPolicy(ctx, ctx.params.id); if (!p.access.can_revise) throw bad('Only a published policy can be revised');
    if (get(`SELECT 1 x FROM policies WHERE supersedes_id=? AND tenant_id=? AND status IN ('draft','in_review','rejected')`, p.id, ctx.t)) throw bad('A new version of this policy is already being prepared');
    const [maj] = String(p.version).split('.'); const next = `${(Number(maj) || 1) + 1}.0`;
    return tx(() => {
      const id = insert('policies', { tenant_id: ctx.t, ref: p.ref, title: p.title, doc_type: p.doc_type, category: p.category, version: next, owner_id: p.owner_id, purpose: p.purpose, scope: p.scope,
        summary: p.summary, driver_framework_id: p.driver_framework_id, review_date: p.review_date, status: 'draft', source: 'authored', supersedes_id: p.id, created_by: ctx.user.id, updated_at: new Date().toISOString() });
      savePolicyBody(ctx, id, { driver_control_ids: p.driver_controls.map(c => c.id), clauses: p.clauses.map(c => ({ number: c.number, text: c.text, control_ids: c.controls.map(x => x.id) })) });
      log(ctx.t, ctx.user.id, 'policy.revise', 'policy', id, `${p.ref} v${next}`); return { id };
    });
  });
  router.delete('/policies/:id', need('policies', 'edit'), ctx => {
    const p = loadPolicy(ctx, ctx.params.id); if (!p.access.can_delete) throw forbidden('Only a draft can be deleted, by its author');
    run('DELETE FROM policies WHERE id=? AND tenant_id=?', p.id, ctx.t); log(ctx.t, ctx.user.id, 'delete', 'policy', p.id, p.title);
  });
};
module.exports.syncMandatory = syncMandatory;
