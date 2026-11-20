'use strict';
// Compliance engine.
// Each assessable control is measured on two dimensions:
//   documentation  — satisfied by a published policy whose clause (or the policy itself) is mapped to the control
//   implementation — satisfied by evidence validated in a gap assessment, or a "Yes" answer in an audit
// A control with no evidence of its own inherits from equivalent controls of other frameworks through the
// Cryptika unified control map: Direct mappings count in full, Partial mappings count at the tenant's
// partial weight (default 0.5), tenant-defined mappings count in full (the tenant owns their correctness).
const { all, get, inList } = require('../db');

function tenantSettings(tenantId) {
  const t = get('SELECT settings FROM tenants WHERE id=?', tenantId);
  return { partial_weight: 0.5, risk_appetite: 6, ...(t ? JSON.parse(t.settings || '{}') : {}) };
}
// Controls the tenant has satisfied directly, with the source of each.
function satisfied(tenantId) {
  const doc = new Map(); const impl = new Map(); const na = new Set();
  const addDoc = r => { if (!doc.has(r.control_id)) doc.set(r.control_id, []); doc.get(r.control_id).push({ policy_id: r.policy_id, ref: r.ref, title: r.title, clause: r.clause || null }); };
  all(`SELECT cc.control_id, p.id policy_id, p.ref, p.title, pc.number clause FROM clause_controls cc
       JOIN policy_clauses pc ON pc.id=cc.clause_id JOIN policies p ON p.id=pc.policy_id
       WHERE p.tenant_id=? AND p.status='published'`, tenantId).forEach(addDoc);
  all(`SELECT d.control_id, p.id policy_id, p.ref, p.title FROM policy_driver_controls d JOIN policies p ON p.id=d.policy_id
       WHERE p.tenant_id=? AND p.status='published'`, tenantId).forEach(addDoc);
  // Implementation: the most recent determination per control wins.
  const det = [
    ...all(`SELECT gi.control_id, gi.status verdict, gi.reviewed_at at, 'Gap assessment ' || ga.ref src, ga.id src_id, 'gap' kind FROM gap_items gi
            JOIN gap_assessments ga ON ga.id=gi.assessment_id WHERE gi.tenant_id=? AND gi.status IN ('valid','invalid','not_applicable')`, tenantId),
    ...all(`SELECT ai.control_id, ai.answer verdict, ai.answered_at at, 'Audit ' || a.ref src, a.id src_id, 'audit' kind FROM audit_items ai
            JOIN audits a ON a.id=ai.audit_id WHERE ai.tenant_id=? AND ai.control_id IS NOT NULL AND ai.answer IN ('yes','no') AND ai.evidence_pending=0`, tenantId),
  ].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  for (const d of det) {
    impl.delete(d.control_id); na.delete(d.control_id);
    if (d.verdict === 'valid' || d.verdict === 'yes') impl.set(d.control_id, { source: d.src, kind: d.kind, id: d.src_id, at: d.at });
    else if (d.verdict === 'not_applicable') na.add(d.control_id);
  }
  return { doc, impl, na };
}
// Controls reachable through the map from a set of satisfied controls: Map(controlId -> {confidence, via:[ids]})
function reach(tenantId, ids) {
  const out = new Map(); const rank = { Partial: 1, Direct: 2, Tenant: 2 };
  const list = [...ids];
  for (let i = 0; i < list.length; i += 500) {
    const rows = all(`SELECT a_id, b_id, confidence FROM control_links WHERE a_id IN (${inList(list.slice(i, i + 500))}) AND tenant_id IN (0, ?)`, tenantId);
    for (const r of rows) {
      const cur = out.get(r.b_id);
      if (!cur) out.set(r.b_id, { confidence: r.confidence, via: [r.a_id] });
      else { if (rank[r.confidence] > rank[cur.confidence]) cur.confidence = r.confidence; if (cur.via.length < 6) cur.via.push(r.a_id); }
    }
  }
  return out;
}
function context(tenantId) {
  const s = satisfied(tenantId);
  return { ...s, docReach: reach(tenantId, s.doc.keys()), implReach: reach(tenantId, s.impl.keys()), settings: tenantSettings(tenantId) };
}
function dimension(controlId, direct, reached, w) {
  if (direct.has(controlId)) return { state: 'direct', score: 1 };
  const r = reached.get(controlId);
  if (!r) return { state: 'gap', score: 0 };
  return r.confidence === 'Partial' ? { state: 'inherited_partial', score: w, via: r.via } : { state: 'inherited', score: 1, via: r.via };
}
function summarise(rows) {
  const blank = () => ({ direct: 0, inherited: 0, inherited_partial: 0, gap: 0, score: 0 });
  const s = { total: rows.length, applicable: 0, not_applicable: 0, doc: blank(), impl: blank() };
  for (const r of rows) {
    if (r.na) { s.not_applicable++; continue; }
    s.applicable++;
    for (const d of ['doc', 'impl']) { s[d][r[d].state]++; s[d].score += r[d].score; }
  }
  const pct = v => s.applicable ? Math.round((v / s.applicable) * 1000) / 10 : 0;
  s.doc.pct = pct(s.doc.score); s.impl.pct = pct(s.impl.score);
  s.overall_pct = Math.round(((s.doc.pct + s.impl.pct) / 2) * 10) / 10;
  return s;
}
// Per-control status for one framework.
function framework(tenantId, frameworkId, ctx = context(tenantId)) {
  const w = Number(ctx.settings.partial_weight);
  const controls = all('SELECT id, ref, title, family, level FROM controls WHERE framework_id=? AND assessable=1 ORDER BY sort', frameworkId);
  const rows = controls.map(c => ({ ...c, na: ctx.na.has(c.id), doc: dimension(c.id, ctx.doc, ctx.docReach, w), impl: dimension(c.id, ctx.impl, ctx.implReach, w) }));
  return { summary: summarise(rows), controls: rows };
}
// Summary for every framework visible to the tenant (adopted or not) — powers "you already comply with…".
function overview(tenantId) {
  const ctx = context(tenantId);
  const fws = all(`SELECT f.*, tf.requirement, tf.basis, CASE WHEN tf.framework_id IS NULL THEN 0 ELSE 1 END adopted
                   FROM frameworks f LEFT JOIN tenant_frameworks tf ON tf.framework_id=f.id AND tf.tenant_id=?
                   WHERE f.tenant_id IS NULL OR f.tenant_id=? ORDER BY f.library, f.sort, f.id`, tenantId, tenantId);
  return fws.map(f => ({ ...f, summary: framework(tenantId, f.id, ctx).summary }));
}
// Explains one control: its own evidence plus the mapped controls it inherits from.
function explain(tenantId, controlId) {
  const ctx = context(tenantId);
  const w = Number(ctx.settings.partial_weight);
  const refs = ids => ids?.length ? all(`SELECT c.id, c.ref, c.title, f.code framework FROM controls c JOIN frameworks f ON f.id=c.framework_id WHERE c.id IN (${inList(ids)})`) : [];
  const doc = dimension(controlId, ctx.doc, ctx.docReach, w); const impl = dimension(controlId, ctx.impl, ctx.implReach, w);
  return {
    doc: { ...doc, policies: ctx.doc.get(controlId) || [], via: refs(doc.via).map(c => ({ ...c, policies: ctx.doc.get(c.id) || [] })) },
    impl: { ...impl, source: ctx.impl.get(controlId) || null, via: refs(impl.via).map(c => ({ ...c, source: ctx.impl.get(c.id) || null })) },
    na: ctx.na.has(controlId),
  };
}
module.exports = { context, framework, overview, explain, tenantSettings, satisfied };
