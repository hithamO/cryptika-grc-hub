'use strict';
// Risk management: assets, threats, vulnerabilities, threat mapping, risk register and risk assessments.
const { all, get, run, insert, update, tx, nextRef, log, inList } = require('../db');
const { need, can } = require('../auth');
const { bad, notFound } = require('../lib/http');
const { crud, pick } = require('./_crud');
const csv = require('../lib/csv');
const workflow = require('../services/workflow');
const ai = require('../services/ai');
const { tenantSettings } = require('../services/coverage');
const { visibleControl } = require('./library');

const level = s => s == null ? null : s >= 17 ? 'Critical' : s >= 10 ? 'High' : s >= 5 ? 'Medium' : 'Low';
// Residual score, as defined by Cryptika: each effectiveness point (0–5) removes 5 points of the 25-point score.
// "Avoid" may bring the score to 0 (the event can no longer happen); every other treatment leaves at least 1.
function scoreItem(item, controls) {
  const inherent = item.likelihood && item.impact ? item.likelihood * item.impact : null;
  const reduction = controls.reduce((s, c) => s + (Number(c.effectiveness) || 0) * 5, 0);
  let residual = inherent;
  if (inherent != null && item.treatment && item.treatment !== 'accept' && controls.length) residual = Math.max(item.treatment === 'avoid' ? 0 : 1, Math.round((inherent - reduction) * 10) / 10);
  return { inherent, inherent_level: level(inherent), reduction, residual, residual_level: level(residual) };
}
function categorise(title, categories) {
  const t = title.toLowerCase();
  for (const c of categories) if (c.keywords && c.keywords.split(',').some(k => k && t.includes(k))) return c.id;
  return categories[categories.length - 1].id;
}
// An organisation that brought its own vulnerability categories uses those; everyone else uses the standard list.
const categoriesFor = t => { const own = all('SELECT * FROM vuln_categories WHERE tenant_id=? ORDER BY id', t); return own.length ? own : all('SELECT * FROM vuln_categories WHERE tenant_id IS NULL ORDER BY id'); };
const ensureAsset = (ctx, name, extra = {}) => {
  let a = get('SELECT id FROM assets WHERE tenant_id=? AND (lower(name)=lower(?) OR ip_address=? OR lower(hostname)=lower(?))', ctx.t, name, name, name);
  if (a) return { id: a.id, created: false };
  return { id: insert('assets', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'AST'), name, criticality: 3, ...extra }), created: true };
};

workflow.register('risk', { label: 'Risk registration', link: () => '#/risk/register',
  onApproved(t, id) { run(`UPDATE risks SET status='registered' WHERE id=?`, id); }, onRejected(t, id) { run(`UPDATE risks SET status='rejected' WHERE id=?`, id); } });
workflow.register('risk_assessment', { label: 'Risk assessment', link: id => `#/risk/assessments/${id}`,
  onApproved(t, id) { run(`UPDATE risk_assessments SET status='completed', completed_at=datetime('now') WHERE id=?`, id); }, onRejected(t, id) { run(`UPDATE risk_assessments SET status='in_progress' WHERE id=?`, id); } });

module.exports = router => {
  // ── Assets ──
  crud(router, '/risk/assets', 'assets', { module: 'risk', fields: ['name', 'asset_type', 'ip_address', 'hostname', 'owner', 'custodian', 'department_id', 'criticality', 'description'], required: ['name'], refPrefix: 'AST',
    listSql: `SELECT a.*, d.name department, (SELECT count(*) FROM vulnerabilities v WHERE v.asset_id=a.id AND v.status='open') open_vulns FROM assets a LEFT JOIN departments d ON d.id=a.department_id WHERE a.tenant_id=? ORDER BY a.id`,
    onDelete: (ctx, row) => { if (get('SELECT 1 x FROM vulnerabilities WHERE asset_id=?', row.id)) throw bad('Vulnerabilities are recorded against this asset'); } });
  router.post('/risk/assets/import', need('risk', 'edit'), ctx => {
    const { records } = csv.parseObjects(String(ctx.body.csv || '')); if (!records.length) throw bad('The file has no rows. Expected columns: Name, Type, IP Address, Hostname, Owner, Custodian, Criticality');
    let created = 0, skipped = 0;
    tx(() => records.forEach(r => {
      const name = r.name || r.asset || r.hostname || r.ip_address; if (!name) { skipped++; return; }
      const res = ensureAsset(ctx, name, { asset_type: r.type || r.asset_type || null, ip_address: r.ip_address || r.ip || null, hostname: r.hostname || null, owner: r.owner || null, custodian: r.custodian || null,
        criticality: Math.min(5, Math.max(1, Number(r.criticality) || 3)), source: 'import' });
      res.created ? created++ : skipped++;
    }));
    log(ctx.t, ctx.user.id, 'assets.import', 'asset', null, `${created} created`); return { created, skipped };
  });

  // ── Threats ──
  crud(router, '/risk/threats', 'threats', { module: 'risk', fields: ['name', 'category', 'description'], required: ['name'], refPrefix: 'THR',
    listSql: `SELECT t.*, (SELECT count(*) FROM threat_mappings m WHERE m.threat_id=t.id) mappings FROM threats t WHERE t.tenant_id=? ORDER BY t.id` });
  router.post('/risk/threats/discover', need('risk', 'edit'), async ctx => {
    const profile = get('SELECT * FROM company_profile WHERE tenant_id=?', ctx.t);
    const existing = all('SELECT name FROM threats WHERE tenant_id=?', ctx.t).map(t => t.name);
    return { profile: { sector: profile?.sector, country: profile?.country }, suggestions: await ai.discoverThreats(ctx.t, profile, all('SELECT * FROM threat_library'), existing) };
  });
  router.post('/risk/threats/bulk', need('risk', 'edit'), ctx => {
    const items = (ctx.body.items || []).filter(i => i && i.name); if (!items.length) throw bad('Select at least one threat');
    tx(() => items.forEach(i => insert('threats', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'THR'), name: i.name, category: i.category, description: i.description, source: i.source === 'ai' ? 'ai' : 'library', rationale: i.rationale })));
    log(ctx.t, ctx.user.id, 'threats.register', 'threat', null, `${items.length} registered`); return { created: items.length };
  });

  // ── Vulnerabilities ──
  router.get('/risk/vuln-categories', need('risk'), ctx => categoriesFor(ctx.t).map(({ id, name, description }) => ({ id, name, description })));
  router.get('/risk/vulnerabilities', need('risk'), ctx => all(`SELECT v.*, a.name asset, a.ref asset_ref, c.name category FROM vulnerabilities v JOIN assets a ON a.id=v.asset_id
    LEFT JOIN vuln_categories c ON c.id=v.category_id WHERE v.tenant_id=? ORDER BY CASE v.severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END, v.id LIMIT 2000`, ctx.t));
  const VFIELDS = ['asset_id', 'title', 'severity', 'cvss', 'cve', 'port', 'category_id', 'description', 'solution', 'status'];
  router.post('/risk/vulnerabilities', need('risk', 'edit'), ctx => {
    const d = pick(ctx.body, VFIELDS, ctx); if (!d.title) throw bad('Describe the vulnerability');
    if (!d.asset_id || !get('SELECT 1 x FROM assets WHERE id=? AND tenant_id=?', d.asset_id, ctx.t)) throw bad('Choose the asset this vulnerability is on');
    if (!d.category_id) d.category_id = categorise(d.title, categoriesFor(ctx.t));
    return { id: insert('vulnerabilities', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'VUL'), ...d }) };
  });
  router.put('/risk/vulnerabilities/:id', need('risk', 'edit'), ctx => { update('vulnerabilities', ctx.params.id, ctx.t, pick(ctx.body, VFIELDS, ctx)); });
  router.delete('/risk/vulnerabilities/:id', need('risk', 'edit'), ctx => {
    if (get('SELECT 1 x FROM risks WHERE vulnerability_id=? AND tenant_id=?', ctx.params.id, ctx.t)) throw bad('A registered risk refers to this vulnerability');
    run('DELETE FROM vulnerabilities WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t);
  });
  // Nessus CSV export (Plugin ID, CVE, CVSS, Risk, Host, Protocol, Port, Name, Synopsis, Description, Solution) or the simple template.
  router.post('/risk/vulnerabilities/import', need('risk', 'edit'), ctx => {
    const { records, keys } = csv.parseObjects(String(ctx.body.csv || '')); if (!records.length) throw bad('The file has no rows');
    const nessus = keys.includes('plugin_id') && keys.includes('host');
    if (!nessus && !(keys.includes('asset') && keys.includes('title'))) throw bad('Unrecognised file. Use a Nessus CSV export, or the template columns: Asset, Title, Severity, CVE, CVSS, Port, Description, Solution');
    const cats = categoriesFor(ctx.t); const rep = { imported: 0, duplicates: 0, informational: 0, assets_created: 0 };
    const sev = s => ({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' })[String(s || '').toLowerCase()] || null;
    tx(() => records.forEach(r => {
      const host = nessus ? r.host : r.asset; const title = nessus ? r.name : r.title; const severity = sev(nessus ? r.risk : r.severity);
      if (!host || !title) return; if (!severity) { rep.informational++; return; }
      const a = ensureAsset(ctx, host, { source: nessus ? 'nessus' : 'import', asset_type: 'Host', ...(/^\d+\.\d+\.\d+\.\d+$/.test(host) ? { ip_address: host } : { hostname: host }) });
      if (a.created) rep.assets_created++;
      const port = r.port && r.port !== '0' ? `${r.port}${r.protocol ? '/' + r.protocol : ''}` : null;
      if (get('SELECT 1 x FROM vulnerabilities WHERE tenant_id=? AND asset_id=? AND title=? AND ifnull(port,\'\')=ifnull(?,\'\')', ctx.t, a.id, title, port)) { rep.duplicates++; return; }
      insert('vulnerabilities', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'VUL'), asset_id: a.id, title, severity, cvss: Number(r.cvss_v3_0_base_score || r.cvss_v2_0_base_score || r.cvss) || null, cve: r.cve || null,
        plugin_id: r.plugin_id || null, port, category_id: categorise(title, cats), description: (r.synopsis ? r.synopsis + '\n' : '') + (r.description || ''), solution: r.solution || null, source: nessus ? 'nessus' : 'import' });
      rep.imported++;
    }));
    log(ctx.t, ctx.user.id, 'vulnerabilities.import', 'vulnerability', null, JSON.stringify(rep)); return rep;
  });

  // ── Threat mapping: which vulnerability categories (or single vulnerabilities) a threat can exploit ──
  router.get('/risk/threat-mappings', need('risk'), ctx => all('SELECT threat_id, category_id, vulnerability_id FROM threat_mappings WHERE tenant_id=?', ctx.t));
  router.put('/risk/threats/:id/mappings', need('risk', 'edit'), ctx => {
    const t = get('SELECT id FROM threats WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!t) throw notFound();
    tx(() => {
      run('DELETE FROM threat_mappings WHERE threat_id=? AND tenant_id=?', t.id, ctx.t);
      for (const c of new Set(ctx.body.category_ids || [])) insert('threat_mappings', { tenant_id: ctx.t, threat_id: t.id, category_id: Number(c) });
      for (const v of new Set(ctx.body.vulnerability_ids || [])) if (get('SELECT 1 x FROM vulnerabilities WHERE id=? AND tenant_id=?', v, ctx.t)) insert('threat_mappings', { tenant_id: ctx.t, threat_id: t.id, vulnerability_id: Number(v) });
    });
  });

  // ── Risk register ──
  router.get('/risk/risks', need('risk'), ctx => all(`SELECT r.*, t.name threat, v.title vulnerability, a.name asset, bp.name process, u.name owner_name, d.name department,
      (SELECT i.likelihood*i.impact FROM risk_assessment_items i WHERE i.risk_id=r.id AND i.likelihood IS NOT NULL ORDER BY i.id DESC LIMIT 1) last_inherent
    FROM risks r LEFT JOIN threats t ON t.id=r.threat_id LEFT JOIN vulnerabilities v ON v.id=r.vulnerability_id LEFT JOIN assets a ON a.id=r.asset_id
    LEFT JOIN business_processes bp ON bp.id=r.process_id LEFT JOIN users u ON u.id=r.owner_id LEFT JOIN departments d ON d.id=r.department_id WHERE r.tenant_id=? ORDER BY r.id DESC`, ctx.t));
  // Threat + vulnerability + asset combinations that are mapped but not yet registered as risks
  router.get('/risk/suggestions', need('risk'), ctx => all(`SELECT DISTINCT t.id threat_id, t.name threat, v.id vulnerability_id, v.title vulnerability, v.severity, a.id asset_id, a.name asset, a.criticality
    FROM threat_mappings m JOIN threats t ON t.id=m.threat_id
    JOIN vulnerabilities v ON v.tenant_id=m.tenant_id AND v.status='open' AND (v.id=m.vulnerability_id OR v.category_id=m.category_id)
    JOIN assets a ON a.id=v.asset_id
    WHERE m.tenant_id=? AND NOT EXISTS (SELECT 1 FROM risks r WHERE r.tenant_id=m.tenant_id AND r.threat_id=t.id AND (r.vulnerability_id=v.id OR r.vulnerability_id IS NULL) AND r.status!='rejected')
    ORDER BY CASE v.severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, a.criticality DESC LIMIT 200`, ctx.t));
  router.post('/risk/risks', need('risk', 'edit'), ctx => {
    const b = ctx.body; const type = b.risk_type === 'business' ? 'business' : 'cyber'; const d = pick(b, ['title', 'description', 'category', 'process_id', 'owner_id', 'department_id'], ctx);
    if (type === 'cyber') {
      // ISO 27001 style: a cyber risk exists only where a threat meets a vulnerability on an asset
      const t = get('SELECT * FROM threats WHERE id=? AND tenant_id=?', b.threat_id, ctx.t); const v = get('SELECT * FROM vulnerabilities WHERE id=? AND tenant_id=?', b.vulnerability_id, ctx.t);
      if (!t || !v) throw bad('A cyber risk needs a registered threat and a vulnerability on an asset. Use "Business risk" for risks that are described in words only.');
      const a = get('SELECT name FROM assets WHERE id=?', v.asset_id);
      Object.assign(d, { threat_id: t.id, vulnerability_id: v.id, asset_id: v.asset_id, title: d.title || `${t.name} — ${v.title} on ${a.name}`, category: d.category || t.category });
    } else if (!d.title) throw bad('Describe the risk');
    return tx(() => {
      const id = insert('risks', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'RSK'), risk_type: type, status: 'pending', created_by: ctx.user.id, ...d });
      const wf = workflow.start(ctx.t, ctx.user, 'risk', id, `Risk: ${d.title}`.slice(0, 140));
      log(ctx.t, ctx.user.id, 'create', 'risk', id, d.title); return { id, workflow: wf.status };
    });
  });
  router.put('/risk/risks/:id', need('risk', 'edit'), ctx => { update('risks', ctx.params.id, ctx.t, pick(ctx.body, ['title', 'description', 'category', 'process_id', 'owner_id', 'department_id', ...(can(ctx.user, 'risk', 'manage') ? ['status'] : [])], ctx)); });
  router.delete('/risk/risks/:id', need('risk', 'manage'), ctx => {
    if (get('SELECT 1 x FROM risk_assessment_items WHERE risk_id=? AND tenant_id=?', ctx.params.id, ctx.t)) throw bad('This risk is part of a risk assessment. Close it instead of deleting it.');
    run('DELETE FROM risks WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t);
  });

  // ── Risk assessments ──
  const loadAssessment = (ctx, id) => {
    const a = get('SELECT ra.*, u.name created_by_name FROM risk_assessments ra LEFT JOIN users u ON u.id=ra.created_by WHERE ra.id=? AND ra.tenant_id=?', id, ctx.t); if (!a) throw notFound('Risk assessment not found');
    const items = all(`SELECT i.*, r.ref risk_ref, r.title risk_title, r.description risk_description, r.risk_type, r.category, t.name threat, v.title vulnerability, s.name asset
      FROM risk_assessment_items i JOIN risks r ON r.id=i.risk_id LEFT JOIN threats t ON t.id=r.threat_id LEFT JOIN vulnerabilities v ON v.id=r.vulnerability_id LEFT JOIN assets s ON s.id=r.asset_id
      WHERE i.assessment_id=? ORDER BY i.id`, a.id);
    const ctrls = items.length ? all(`SELECT rc.*, c.ref, c.title, f.code framework FROM risk_item_controls rc LEFT JOIN controls c ON c.id=rc.control_id LEFT JOIN frameworks f ON f.id=c.framework_id
      WHERE rc.item_id IN (${inList(items.map(i => i.id))}) ORDER BY rc.id`) : [];
    a.items = items.map(i => { const cs = ctrls.filter(c => c.item_id === i.id); return { ...i, controls: cs, ...scoreItem(i, cs), within_appetite: null }; });
    for (const i of a.items) if (i.residual != null) i.within_appetite = i.residual <= a.appetite;
    a.workflow = workflow.forEntity(ctx.t, 'risk_assessment', a.id);
    a.editable = a.status === 'in_progress' && can(ctx.user, 'risk', 'edit');
    return a;
  };
  const editableItem = (ctx, itemId) => {
    const i = get(`SELECT i.*, ra.status a_status FROM risk_assessment_items i JOIN risk_assessments ra ON ra.id=i.assessment_id WHERE i.id=? AND i.tenant_id=?`, itemId, ctx.t);
    if (!i) throw notFound(); if (i.a_status !== 'in_progress') throw bad('This assessment is closed for editing'); return i;
  };
  router.get('/risk/assessments', need('risk'), ctx => all(`SELECT ra.*, u.name created_by_name, (SELECT count(*) FROM risk_assessment_items i WHERE i.assessment_id=ra.id) risks
    FROM risk_assessments ra LEFT JOIN users u ON u.id=ra.created_by WHERE ra.tenant_id=? ORDER BY ra.id DESC`, ctx.t));
  router.post('/risk/assessments', need('risk', 'edit'), ctx => {
    const b = ctx.body; if (!b.name) throw bad('Name the assessment'); const ids = [...new Set((b.risk_ids || []).map(Number))];
    if (!ids.length) throw bad('Select at least one risk from the register');
    const ok = all(`SELECT id FROM risks WHERE tenant_id=? AND status='registered' AND id IN (${inList(ids)})`, ctx.t).map(r => r.id);
    if (!ok.length) throw bad('Only registered risks can be assessed');
    return tx(() => {
      const id = insert('risk_assessments', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'RA'), name: b.name, purpose: b.purpose, basis: b.basis, appetite: Number(b.appetite) || tenantSettings(ctx.t).risk_appetite, created_by: ctx.user.id });
      ok.forEach(rid => insert('risk_assessment_items', { tenant_id: ctx.t, assessment_id: id, risk_id: rid }));
      log(ctx.t, ctx.user.id, 'create', 'risk_assessment', id, b.name); return { id };
    });
  });
  router.get('/risk/assessments/:id', need('risk'), ctx => loadAssessment(ctx, ctx.params.id));
  router.put('/risk/assessment-items/:id', need('risk', 'edit'), ctx => {
    const i = editableItem(ctx, ctx.params.id); const d = pick(ctx.body, ['likelihood', 'impact', 'notes', 'treatment', 'treatment_plan', 'treatment_owner', 'due_date'], ctx);
    for (const k of ['likelihood', 'impact']) if (d[k] != null && !(d[k] >= 1 && d[k] <= 5)) throw bad('Likelihood and impact are rated from 1 to 5');
    if (d.treatment && !['accept', 'mitigate', 'transfer', 'avoid'].includes(d.treatment)) throw bad('Unknown treatment option');
    update('risk_assessment_items', i.id, ctx.t, d);
  });
  router.get('/risk/assessment-items/:id/control-suggestions', need('risk'), ctx => {
    const i = get(`SELECT r.title, r.description, t.name threat FROM risk_assessment_items i JOIN risks r ON r.id=i.risk_id LEFT JOIN threats t ON t.id=r.threat_id WHERE i.id=? AND i.tenant_id=?`, ctx.params.id, ctx.t); if (!i) throw notFound();
    const stop = new Set(['with', 'from', 'that', 'this', 'attack', 'through', 'against', 'access', 'system', 'systems', 'information']);
    const words = [...new Set(`${i.threat || ''} ${i.title}`.toLowerCase().match(/[a-z]{5,}/g) || [])].filter(w => !stop.has(w)).slice(0, 6);
    if (!words.length) return [];
    return all(`SELECT c.id, c.ref, c.title, f.code framework FROM controls c JOIN frameworks f ON f.id=c.framework_id JOIN tenant_frameworks tf ON tf.framework_id=f.id AND tf.tenant_id=?
      WHERE c.assessable=1 AND (${words.map(() => 'c.title LIKE ?').join(' OR ')}) ORDER BY f.sort, c.sort LIMIT 12`, ctx.t, ...words.map(w => `%${w}%`));
  });
  router.post('/risk/assessment-items/:id/controls', need('risk', 'edit'), ctx => {
    const i = editableItem(ctx, ctx.params.id); const b = ctx.body;
    if (b.control_id) { visibleControl(ctx, b.control_id); if (get('SELECT 1 x FROM risk_item_controls WHERE item_id=? AND control_id=?', i.id, b.control_id)) throw bad('This control is already selected for the risk'); }
    else if (!String(b.custom_control || '').trim()) throw bad('Choose a framework control or describe your own control');
    return { id: insert('risk_item_controls', { tenant_id: ctx.t, item_id: i.id, control_id: b.control_id || null, custom_control: b.control_id ? null : String(b.custom_control).trim() }) };
  });
  const loadItemControl = (ctx, id) => {
    const rc = get(`SELECT rc.*, i.treatment, i.risk_id, ra.status a_status FROM risk_item_controls rc JOIN risk_assessment_items i ON i.id=rc.item_id JOIN risk_assessments ra ON ra.id=i.assessment_id WHERE rc.id=? AND rc.tenant_id=?`, id, ctx.t);
    if (!rc) throw notFound(); if (rc.a_status !== 'in_progress') throw bad('This assessment is closed for editing'); return rc;
  };
  // The analyst's own rating always wins over the suggestion
  router.put('/risk/item-controls/:id', need('risk', 'edit'), ctx => {
    const rc = loadItemControl(ctx, ctx.params.id); const e = ctx.body.effectiveness;
    if (e === null || e === '') return run(`UPDATE risk_item_controls SET effectiveness=ai_suggestion, effectiveness_source=CASE WHEN ai_suggestion IS NULL THEN NULL ELSE 'ai' END WHERE id=?`, rc.id) && undefined;
    if (!(Number(e) >= 0 && Number(e) <= 5)) throw bad('Effectiveness is rated from 0 to 5');
    run(`UPDATE risk_item_controls SET effectiveness=?, effectiveness_source='user' WHERE id=?`, Number(e), rc.id);
  });
  // Advisory suggestion; it becomes the working value only while the analyst has not entered one
  router.post('/risk/item-controls/:id/suggest', need('risk', 'edit'), async ctx => {
    const rc = loadItemControl(ctx, ctx.params.id);
    const control = rc.control_id ? get('SELECT title, description FROM controls WHERE id=?', rc.control_id) : { title: rc.custom_control, description: '' };
    const s = await ai.suggestEffectiveness(ctx.t, { control, risk: get('SELECT title, description FROM risks WHERE id=?', rc.risk_id), profile: get('SELECT * FROM company_profile WHERE tenant_id=?', ctx.t), treatment: rc.treatment });
    run(`UPDATE risk_item_controls SET ai_suggestion=?, ai_rationale=?, effectiveness=CASE WHEN effectiveness_source='user' THEN effectiveness ELSE ? END,
         effectiveness_source=CASE WHEN effectiveness_source='user' THEN 'user' ELSE 'ai' END WHERE id=?`, s.score, `${s.rationale} (${s.engine})`, s.score, rc.id);
    return s;
  });
  router.delete('/risk/item-controls/:id', need('risk', 'edit'), ctx => { const rc = loadItemControl(ctx, ctx.params.id); run('DELETE FROM risk_item_controls WHERE id=?', rc.id); });
  router.post('/risk/assessments/:id/complete', need('risk', 'edit'), ctx => {
    const a = loadAssessment(ctx, ctx.params.id); if (a.status !== 'in_progress') throw bad('This assessment has already been submitted');
    const missing = a.items.filter(i => i.inherent == null || !i.treatment);
    if (missing.length) throw bad(`${missing.length} risk(s) still need a likelihood, an impact and a treatment decision`);
    return tx(() => { run(`UPDATE risk_assessments SET status='in_review' WHERE id=?`, a.id); return workflow.start(ctx.t, ctx.user, 'risk_assessment', a.id, `${a.ref} ${a.name}`); });
  });
  router.delete('/risk/assessments/:id', need('risk', 'manage'), ctx => { run('DELETE FROM risk_assessments WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });
};
module.exports.scoreItem = scoreItem;
module.exports.level = level;
