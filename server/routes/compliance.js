'use strict';
// Compliance: coverage per framework, gap assessments (implementation evidence), evidence files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { all, get, run, insert, update, tx, nextRef, log, notify, inList, DATA_DIR } = require('../db');
const { tenant, need, can } = require('../auth');
const { bad, notFound, forbidden } = require('../lib/http');
const coverage = require('../services/coverage');
const ai = require('../services/ai');
const { visibleFramework } = require('./library');

const deptUsers = (t, deptId) => all('SELECT id FROM users WHERE tenant_id=? AND department_id=? AND active=1', t, deptId).map(u => u.id);
const itemSql = `SELECT gi.*, c.ref, c.title, c.description, c.family, d.name department, sd.name suggested_department, su.name submitted_by_name, ru.name reviewed_by_name,
    (SELECT count(*) FROM evidence e WHERE e.entity_type='gap_item' AND e.entity_id=gi.id) files
  FROM gap_items gi JOIN controls c ON c.id=gi.control_id LEFT JOIN departments d ON d.id=gi.department_id LEFT JOIN departments sd ON sd.id=gi.suggested_department_id
  LEFT JOIN users su ON su.id=gi.submitted_by LEFT JOIN users ru ON ru.id=gi.reviewed_by`;

// Who may see / add evidence on a record
function evidenceAccess(ctx, type, id, write) {
  if (type === 'gap_item') {
    const gi = get(`SELECT gi.*, ga.status a_status FROM gap_items gi JOIN gap_assessments ga ON ga.id=gi.assessment_id WHERE gi.id=? AND gi.tenant_id=?`, id, ctx.t); if (!gi) throw notFound();
    const mine = ctx.user.department_id && ctx.user.department_id === gi.department_id;
    if (!(mine || can(ctx.user, 'compliance', write ? 'edit' : 'view'))) throw forbidden();
    if (write && !['requested', 'invalid', 'submitted'].includes(gi.status)) throw bad('Evidence can be added once the control has been requested from a department');
    return;
  }
  if (type === 'audit_item' || type === 'finding') {
    const tbl = type === 'audit_item' ? 'audit_items' : 'findings';
    if (!get(`SELECT 1 x FROM ${tbl} WHERE id=? AND tenant_id=?`, id, ctx.t)) throw notFound();
    if (!can(ctx.user, 'audit', write ? 'edit' : 'view')) throw forbidden(); return;
  }
  throw bad('Evidence cannot be attached to this kind of record');
}

module.exports = router => {
  router.get('/compliance/overview', need('compliance'), ctx => ({ frameworks: coverage.overview(ctx.t), settings: { partial_weight: coverage.tenantSettings(ctx.t).partial_weight } }));
  router.get('/compliance/frameworks/:id', need('compliance'), ctx => {
    const f = visibleFramework(ctx, ctx.params.id);
    return { framework: { ...f, adopted: !!get('SELECT 1 x FROM tenant_frameworks WHERE tenant_id=? AND framework_id=?', ctx.t, f.id) }, ...coverage.framework(ctx.t, f.id), partial_weight: coverage.tenantSettings(ctx.t).partial_weight };
  });

  // ── Gap assessments ──
  router.get('/compliance/gap-assessments', need('compliance'), ctx => all(`SELECT ga.*, f.code framework, u.name created_by_name,
      (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id) items,
      (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id AND i.status='valid') valid,
      (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id AND i.status='submitted') submitted,
      (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id AND i.status IN ('requested','invalid')) waiting,
      (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id AND i.status='unassigned') unassigned
    FROM gap_assessments ga JOIN frameworks f ON f.id=ga.framework_id LEFT JOIN users u ON u.id=ga.created_by WHERE ga.tenant_id=? ORDER BY ga.id DESC`, ctx.t));
  router.post('/compliance/gap-assessments', need('compliance', 'edit'), ctx => {
    const b = ctx.body; const f = visibleFramework(ctx, b.framework_id);
    const cov = coverage.framework(ctx.t, f.id);
    // Documentation is measured automatically from policies; a gap assessment collects implementation evidence only.
    const targets = cov.controls.filter(c => !c.na && (b.include_satisfied ? true : c.impl.state !== 'direct'));
    if (!targets.length) throw bad('Every control of this framework already has validated implementation evidence');
    const depts = all('SELECT id, name FROM departments WHERE tenant_id=?', ctx.t);
    const text = Object.fromEntries(all(`SELECT id, title, description FROM controls WHERE id IN (${inList(targets.map(c => c.id))})`).map(c => [c.id, c]));
    return tx(() => {
      const id = insert('gap_assessments', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'GAP'), name: b.name || `${f.code} gap assessment`, framework_id: f.id, due_date: b.due_date || null, created_by: ctx.user.id });
      for (const c of targets) insert('gap_items', { tenant_id: ctx.t, assessment_id: id, control_id: c.id, suggested_department_id: ai.suggestDepartment(text[c.id], depts), evidence_guidance: ai.evidenceGuidance(text[c.id]) });
      log(ctx.t, ctx.user.id, 'create', 'gap_assessment', id, f.code); return { id, items: targets.length };
    });
  });
  const loadGap = (ctx, id) => { const a = get(`SELECT ga.*, f.code framework, f.name framework_name FROM gap_assessments ga JOIN frameworks f ON f.id=ga.framework_id WHERE ga.id=? AND ga.tenant_id=?`, id, ctx.t); if (!a) throw notFound('Gap assessment not found'); return a; };
  router.get('/compliance/gap-assessments/:id', need('compliance'), ctx => {
    const a = loadGap(ctx, ctx.params.id);
    return { ...a, items: all(`${itemSql} WHERE gi.assessment_id=? ORDER BY c.sort`, a.id), can_manage: can(ctx.user, 'compliance', 'edit') };
  });
  router.delete('/compliance/gap-assessments/:id', need('compliance', 'manage'), ctx => { const a = loadGap(ctx, ctx.params.id); run('DELETE FROM gap_assessments WHERE id=?', a.id); });
  // Assign controls to departments: explicit, or accept the suggested department for everything still unassigned
  router.post('/compliance/gap-assessments/:id/assign', need('compliance', 'edit'), ctx => {
    const a = loadGap(ctx, ctx.params.id); const b = ctx.body;
    if (b.accept_suggestions) { run(`UPDATE gap_items SET department_id=suggested_department_id WHERE assessment_id=? AND department_id IS NULL AND status='unassigned'`, a.id); return; }
    const dept = get('SELECT id FROM departments WHERE id=? AND tenant_id=?', b.department_id, ctx.t); if (!dept) throw bad('Choose a department');
    const ids = (b.item_ids || []).map(Number); if (!ids.length) throw bad('Select the controls to assign');
    run(`UPDATE gap_items SET department_id=? WHERE assessment_id=? AND id IN (${inList(ids)}) AND status IN ('unassigned','requested','invalid')`, dept.id, a.id);
  });
  router.put('/compliance/gap-items/:id', need('compliance', 'edit'), ctx => {
    const gi = get('SELECT * FROM gap_items WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!gi) throw notFound(); const b = ctx.body; const patch = {};
    if (b.evidence_guidance !== undefined) patch.evidence_guidance = b.evidence_guidance;
    if (b.department_id !== undefined) { if (b.department_id && !get('SELECT 1 x FROM departments WHERE id=? AND tenant_id=?', b.department_id, ctx.t)) throw bad('Unknown department'); patch.department_id = b.department_id || null; }
    if (b.status === 'not_applicable') Object.assign(patch, { status: 'not_applicable', reviewer_note: b.reviewer_note || 'Not applicable', reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString() });
    if (b.status === 'unassigned' && gi.status === 'not_applicable') Object.assign(patch, { status: 'unassigned', reviewer_note: null, reviewed_at: null });
    update('gap_items', gi.id, ctx.t, patch);
  });
  // Send the evidence requests: each department is notified of its own controls only
  router.post('/compliance/gap-assessments/:id/send', need('compliance', 'edit'), ctx => {
    const a = loadGap(ctx, ctx.params.id);
    const ready = all(`SELECT id, department_id FROM gap_items WHERE assessment_id=? AND status='unassigned' AND department_id IS NOT NULL`, a.id);
    if (!ready.length) throw bad('Assign controls to departments first');
    tx(() => {
      run(`UPDATE gap_items SET status='requested' WHERE assessment_id=? AND status='unassigned' AND department_id IS NOT NULL`, a.id);
      run(`UPDATE gap_assessments SET status='in_progress' WHERE id=?`, a.id);
      const by = new Map(); ready.forEach(r => by.set(r.department_id, (by.get(r.department_id) || 0) + 1));
      for (const [dept, n] of by) notify(ctx.t, deptUsers(ctx.t, dept), `Evidence requested: ${a.framework}`, `${n} control(s) need evidence from your department${a.due_date ? ' by ' + a.due_date : ''}`, '#/compliance/requests');
    });
    log(ctx.t, ctx.user.id, 'gap.send', 'gap_assessment', a.id, `${ready.length} requests`); return { requested: ready.length };
  });
  // The department's side
  router.get('/compliance/requests', tenant, ctx => {
    const manage = can(ctx.user, 'compliance', 'edit');
    if (!ctx.user.department_id && !manage) return [];
    return all(`${itemSql} JOIN gap_assessments ga ON ga.id=gi.assessment_id WHERE gi.tenant_id=? AND ga.status='in_progress' AND gi.status IN ('requested','invalid','submitted') AND gi.department_id=? ORDER BY gi.status, c.sort`, ctx.t, ctx.user.department_id || -1)
      .map(i => ({ ...i, assessment: get('SELECT ref, name, due_date, (SELECT code FROM frameworks f WHERE f.id=framework_id) framework FROM gap_assessments WHERE id=?', i.assessment_id) }));
  });
  router.post('/compliance/gap-items/:id/submit', tenant, ctx => {
    const gi = get('SELECT gi.*, ga.created_by owner, ga.ref a_ref FROM gap_items gi JOIN gap_assessments ga ON ga.id=gi.assessment_id WHERE gi.id=? AND gi.tenant_id=?', ctx.params.id, ctx.t); if (!gi) throw notFound();
    if (!(ctx.user.department_id === gi.department_id || can(ctx.user, 'compliance', 'edit'))) throw forbidden('This request belongs to another department');
    if (!['requested', 'invalid'].includes(gi.status)) throw bad('This request is not waiting for evidence');
    const files = get(`SELECT count(*) n FROM evidence WHERE entity_type='gap_item' AND entity_id=?`, gi.id).n;
    if (!files && !String(ctx.body.response_note || '').trim()) throw bad('Attach at least one file or write a note explaining the evidence');
    update('gap_items', gi.id, ctx.t, { status: 'submitted', response_note: ctx.body.response_note || null, submitted_by: ctx.user.id, submitted_at: new Date().toISOString() });
    notify(ctx.t, [gi.owner], `Evidence submitted (${gi.a_ref})`, `${ctx.user.name} submitted evidence for review`, `#/compliance/gaps/${gi.assessment_id}`);
  });
  // The compliance function decides — a person, not the system
  router.post('/compliance/gap-items/:id/review', need('compliance', 'edit'), ctx => {
    const gi = get('SELECT * FROM gap_items WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!gi) throw notFound();
    const v = ctx.body.verdict; if (!['valid', 'invalid'].includes(v)) throw bad('Decide: valid or invalid');
    if (!['submitted', 'valid', 'invalid'].includes(gi.status)) throw bad('No evidence has been submitted for this control yet');
    if (v === 'invalid' && !String(ctx.body.note || '').trim()) throw bad('Explain what is wrong with the evidence so the department can correct it');
    update('gap_items', gi.id, ctx.t, { status: v, reviewer_note: ctx.body.note || null, reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString() });
    if (v === 'invalid' && gi.department_id) notify(ctx.t, deptUsers(ctx.t, gi.department_id), 'Evidence returned', String(ctx.body.note), '#/compliance/requests');
    log(ctx.t, ctx.user.id, 'gap.review', 'gap_item', gi.id, v);
  });
  router.post('/compliance/gap-assessments/:id/complete', need('compliance', 'edit'), ctx => {
    const a = loadGap(ctx, ctx.params.id); run(`UPDATE gap_assessments SET status='completed', completed_at=datetime('now') WHERE id=?`, a.id); log(ctx.t, ctx.user.id, 'gap.complete', 'gap_assessment', a.id, null);
  });

  // ── Evidence files ──
  router.get('/evidence', tenant, ctx => {
    evidenceAccess(ctx, ctx.query.entity_type, ctx.query.entity_id, false);
    return all(`SELECT e.id, e.filename, e.size, e.version, e.note, e.uploaded_at, u.name uploaded_by FROM evidence e LEFT JOIN users u ON u.id=e.uploaded_by
                WHERE e.tenant_id=? AND e.entity_type=? AND e.entity_id=? ORDER BY e.id`, ctx.t, ctx.query.entity_type, ctx.query.entity_id);
  });
  router.post('/evidence', tenant, ctx => {
    const { entity_type, entity_id } = ctx.query; const filename = path.basename(String(ctx.query.filename || '')).slice(0, 200);
    evidenceAccess(ctx, entity_type, entity_id, true);
    if (!filename || !ctx.raw || !ctx.raw.length) throw bad('Choose a file to upload');
    if (/\.(exe|bat|cmd|com|scr|js|vbs|ps1|msi|dll|sh)$/i.test(filename)) throw bad('This file type is not accepted as evidence');
    const dir = path.join(DATA_DIR, 'uploads', String(ctx.t)); fs.mkdirSync(dir, { recursive: true });
    const stored = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(path.join(dir, stored), ctx.raw);
    const version = get('SELECT count(*) n FROM evidence WHERE tenant_id=? AND entity_type=? AND entity_id=? AND filename=?', ctx.t, entity_type, entity_id, filename).n + 1;
    const id = insert('evidence', { tenant_id: ctx.t, entity_type, entity_id: Number(entity_id), filename, stored_name: stored, size: ctx.raw.length, mime: ctx.req.headers['content-type'], version, uploaded_by: ctx.user.id });
    log(ctx.t, ctx.user.id, 'evidence.upload', entity_type, Number(entity_id), filename); return { id, version };
  });
  router.get('/evidence/:id/download', tenant, ctx => {
    const e = get('SELECT * FROM evidence WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!e) throw notFound();
    evidenceAccess(ctx, e.entity_type, e.entity_id, false);
    const file = path.join(DATA_DIR, 'uploads', String(ctx.t), e.stored_name); if (!fs.existsSync(file)) throw notFound('The stored file is missing');
    ctx.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(e.filename)}`, 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(ctx.res);
    return new Promise(r => ctx.res.on('close', r));
  });
  router.delete('/evidence/:id', tenant, ctx => {
    const e = get('SELECT * FROM evidence WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!e) throw notFound();
    evidenceAccess(ctx, e.entity_type, e.entity_id, true);
    if (e.uploaded_by !== ctx.user.id && !can(ctx.user, 'compliance', 'manage') && !can(ctx.user, 'audit', 'manage')) throw forbidden('Only the person who uploaded a file can remove it');
    run('DELETE FROM evidence WHERE id=?', e.id); fs.rmSync(path.join(DATA_DIR, 'uploads', String(ctx.t), e.stored_name), { force: true });
  });
};
