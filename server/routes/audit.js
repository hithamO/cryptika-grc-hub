'use strict';
// Audit: question pool (risk-control matrix), audit programmes, sessions, fieldwork, findings and corrective actions.
const { all, get, run, insert, update, tx, nextRef, log, inList } = require('../db');
const { need } = require('../auth');
const { bad, notFound } = require('../lib/http');
const { crud, pick } = require('./_crud');
const csv = require('../lib/csv');
const { filterControlIds, visibleFramework } = require('./library');

// Keeps the automatic finding of an audit item in step with its answer.
function syncFinding(ctx, item) {
  const f = get(`SELECT * FROM findings WHERE tenant_id=? AND audit_item_id=?`, ctx.t, item.id);
  const want = item.answer === 'no' || item.answer === 'partial' ? 'confirmed' : (item.answer === 'yes' && item.evidence_pending ? 'potential' : null);
  if (!want) { if (f && ['open', 'in_progress'].includes(f.status)) run(`UPDATE findings SET status='closed', description=ifnull(description,'') || char(10) || 'Closed automatically: the audit answer was updated.' WHERE id=?`, f.id); return; }
  const c = item.control_id ? get('SELECT c.ref, f.code FROM controls c JOIN frameworks f ON f.id=c.framework_id WHERE c.id=?', item.control_id) : null;
  const title = `${want === 'potential' ? 'Evidence outstanding' : item.answer === 'partial' ? 'Partially met' : 'Not met'}${c ? `: ${c.code} ${c.ref}` : ''}`;
  if (f) run(`UPDATE findings SET finding_type=?, title=?, status=CASE WHEN status='closed' THEN 'open' ELSE status END WHERE id=?`, want, title, f.id);
  else insert('findings', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'FND'), audit_id: item.audit_id, audit_item_id: item.id, control_id: item.control_id, title,
    description: `${item.question}${item.notes ? '\nAuditor note: ' + item.notes : ''}`, severity: want === 'potential' ? 'Low' : 'Medium', finding_type: want, created_by: ctx.user.id });
}

module.exports = router => {
  // ── Question pool ──
  router.get('/audit/questions', need('audit'), ctx => {
    const qs = all('SELECT * FROM audit_questions WHERE tenant_id=? ORDER BY topic, id', ctx.t);
    const cc = all(`SELECT qc.question_id, c.id, c.ref, c.title, f.code framework FROM audit_question_controls qc JOIN controls c ON c.id=qc.control_id JOIN frameworks f ON f.id=c.framework_id
                    WHERE qc.question_id IN (SELECT id FROM audit_questions WHERE tenant_id=?)`, ctx.t);
    return qs.map(q => ({ ...q, controls: cc.filter(c => c.question_id === q.id).map(({ question_id, ...r }) => r) }));
  });
  const QF = ['topic', 'question', 'guidance', 'expected_evidence', 'auditee'];
  const setQControls = (ctx, qid, ids) => { run('DELETE FROM audit_question_controls WHERE question_id=?', qid); for (const c of filterControlIds(ctx, ids)) run('INSERT INTO audit_question_controls (question_id, control_id) VALUES (?,?)', qid, c); };
  router.post('/audit/questions', need('audit', 'edit'), ctx => { if (!ctx.body.question) throw bad('Write the question'); return tx(() => { const id = insert('audit_questions', { tenant_id: ctx.t, ...pick(ctx.body, QF, ctx) }); setQControls(ctx, id, ctx.body.control_ids); return { id }; }); });
  router.put('/audit/questions/:id', need('audit', 'edit'), ctx => { const q = get('SELECT id FROM audit_questions WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!q) throw notFound(); tx(() => { update('audit_questions', q.id, ctx.t, pick(ctx.body, QF, ctx)); if (ctx.body.control_ids) setQControls(ctx, q.id, ctx.body.control_ids); }); });
  router.delete('/audit/questions/:id', need('audit', 'edit'), ctx => { run('DELETE FROM audit_questions WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });
  router.get('/audit/questions-template', need('audit'), ctx => {
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit-question-pool-template.csv"' });
    ctx.res.end(csv.stringify(['Topic', 'Question', 'Guidance', 'Expected Evidence', 'Auditee', 'Controls'], [
      ['Access management', 'Are user access rights reviewed at planned intervals?', 'Ask how often and who signs off.', 'Last two access review records', 'IT Manager', 'ISO 27001:2022|A.5.18; NIST CSF 2.0|PR.AA-05'],
    ]));
  });
  router.post('/audit/questions/import', need('audit', 'edit'), ctx => {
    const { records } = csv.parseObjects(String(ctx.body.csv || '')); if (!records.length) throw bad('The file has no rows');
    const fw = Object.fromEntries(all('SELECT id, code FROM frameworks WHERE tenant_id IS NULL OR tenant_id=?', ctx.t).map(x => [x.code.toLowerCase(), x.id]));
    const rep = { created: 0, problems: [] };
    tx(() => records.forEach((r, i) => {
      if (!r.question) { rep.problems.push(`Row ${i + 2}: no question`); return; }
      const id = insert('audit_questions', { tenant_id: ctx.t, topic: r.topic || null, question: r.question, guidance: r.guidance || null, expected_evidence: r.expected_evidence || null, auditee: r.auditee || null }); rep.created++;
      for (const m of (r.controls || '').split(';').map(s => s.trim()).filter(Boolean)) {
        const [code, ref] = m.split('|').map(s => s.trim()); const c = fw[(code || '').toLowerCase()] ? get('SELECT id FROM controls WHERE framework_id=? AND ref=?', fw[code.toLowerCase()], ref) : null;
        if (c) run('INSERT OR IGNORE INTO audit_question_controls (question_id, control_id) VALUES (?,?)', id, c.id); else rep.problems.push(`Row ${i + 2}: control "${m}" not found`);
      }
    }));
    return rep;
  });

  // ── Audit programmes ──
  router.get('/audit/audits', need('audit'), ctx => all(`SELECT a.*, f.code framework, u.name lead_name,
      (SELECT count(*) FROM audit_items i WHERE i.audit_id=a.id) items, (SELECT count(*) FROM audit_items i WHERE i.audit_id=a.id AND i.answer!='pending') answered,
      (SELECT count(*) FROM findings x WHERE x.audit_id=a.id AND x.status IN ('open','in_progress')) open_findings
    FROM audits a LEFT JOIN frameworks f ON f.id=a.framework_id LEFT JOIN users u ON u.id=a.lead_id WHERE a.tenant_id=? ORDER BY a.id DESC`, ctx.t));
  // Creating a programme for a framework pulls every pool question written for one of its controls — directly or through
  // the unified control map — and, if asked, adds a standard question for each control the pool does not cover yet.
  router.post('/audit/audits', need('audit', 'edit'), ctx => {
    const b = ctx.body; if (!b.title) throw bad('Give the audit a title');
    const f = b.framework_id ? visibleFramework(ctx, b.framework_id) : null;
    return tx(() => {
      const id = insert('audits', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'AUD'), ...pick(b, ['title', 'objective', 'scope', 'lead_id', 'start_date', 'end_date'], ctx), framework_id: f ? f.id : null, created_by: ctx.user.id });
      let fromPool = 0, generated = 0;
      if (f) {
        const controls = all('SELECT id, ref, title, description FROM controls WHERE framework_id=? AND assessable=1 ORDER BY sort', f.id);
        const ids = new Set(controls.map(c => c.id)); const covered = new Set();
        const qc = all(`SELECT q.*, qc.control_id FROM audit_questions q JOIN audit_question_controls qc ON qc.question_id=q.id WHERE q.tenant_id=?`, ctx.t);
        const used = new Set();
        const add = (q, controlId) => { if (used.has(q.id + ':' + controlId)) return; used.add(q.id + ':' + controlId); covered.add(controlId);
          insert('audit_items', { tenant_id: ctx.t, audit_id: id, question_id: q.id, control_id: controlId, topic: q.topic, question: q.question, expected_evidence: q.expected_evidence, auditee: q.auditee }); fromPool++; };
        for (const q of qc) {
          if (ids.has(q.control_id)) { add(q, q.control_id); continue; }
          const eq = all(`SELECT l.b_id FROM control_links l JOIN controls c ON c.id=l.b_id WHERE l.a_id=? AND l.tenant_id IN (0,?) AND c.framework_id=? AND c.assessable=1 LIMIT 3`, q.control_id, ctx.t, f.id);
          eq.forEach(e => add(q, e.b_id));
        }
        if (b.include_generated) for (const c of controls) if (!covered.has(c.id)) {
          insert('audit_items', { tenant_id: ctx.t, audit_id: id, control_id: c.id, topic: f.code, question: `${c.ref}${c.title ? ' — ' + c.title : ''}: is this requirement implemented and operating as intended?`,
            expected_evidence: 'Records or system output demonstrating the requirement in operation' }); generated++;
        }
      }
      log(ctx.t, ctx.user.id, 'create', 'audit', id, b.title); return { id, from_pool: fromPool, generated };
    });
  });
  const loadAudit = (ctx, id) => { const a = get(`SELECT a.*, f.code framework, u.name lead_name FROM audits a LEFT JOIN frameworks f ON f.id=a.framework_id LEFT JOIN users u ON u.id=a.lead_id WHERE a.id=? AND a.tenant_id=?`, id, ctx.t); if (!a) throw notFound('Audit not found'); return a; };
  router.get('/audit/audits/:id', need('audit'), ctx => {
    const a = loadAudit(ctx, ctx.params.id);
    a.sessions = all('SELECT s.*, d.name department FROM audit_sessions s LEFT JOIN departments d ON d.id=s.department_id WHERE s.audit_id=? ORDER BY s.session_date, s.start_time, s.id', a.id);
    a.items = all(`SELECT i.*, c.ref control_ref, f.code control_framework, (SELECT count(*) FROM evidence e WHERE e.entity_type='audit_item' AND e.entity_id=i.id) files,
        (SELECT x.ref FROM findings x WHERE x.audit_item_id=i.id AND x.status!='closed') finding_ref
      FROM audit_items i LEFT JOIN controls c ON c.id=i.control_id LEFT JOIN frameworks f ON f.id=c.framework_id WHERE i.audit_id=? ORDER BY i.id`, a.id);
    a.findings = all(`SELECT * FROM findings WHERE audit_id=? AND tenant_id=? ORDER BY id`, a.id, ctx.t);
    a.suggested_auditees = [...new Set(a.items.map(i => i.auditee).filter(Boolean))];
    return a;
  });
  router.put('/audit/audits/:id', need('audit', 'edit'), ctx => {
    const a = loadAudit(ctx, ctx.params.id); const d = pick(ctx.body, ['title', 'objective', 'scope', 'lead_id', 'start_date', 'end_date', 'status'], ctx);
    if (d.status && !['planned', 'fieldwork', 'reporting', 'closed'].includes(d.status)) throw bad('Unknown audit status');
    update('audits', a.id, ctx.t, d); log(ctx.t, ctx.user.id, 'update', 'audit', a.id, d.status || null);
  });
  router.delete('/audit/audits/:id', need('audit', 'manage'), ctx => { const a = loadAudit(ctx, ctx.params.id); run('DELETE FROM audits WHERE id=?', a.id); });
  router.post('/audit/audits/:id/sessions', need('audit', 'edit'), ctx => { const a = loadAudit(ctx, ctx.params.id); if (!ctx.body.title) throw bad('Name the session');
    return { id: insert('audit_sessions', { tenant_id: ctx.t, audit_id: a.id, ...pick(ctx.body, ['title', 'auditee', 'department_id', 'session_date', 'start_time', 'duration_min', 'location'], ctx) }) }; });
  router.put('/audit/sessions/:id', need('audit', 'edit'), ctx => { update('audit_sessions', ctx.params.id, ctx.t, pick(ctx.body, ['title', 'auditee', 'department_id', 'session_date', 'start_time', 'duration_min', 'location'], ctx)); });
  router.delete('/audit/sessions/:id', need('audit', 'edit'), ctx => { run('UPDATE audit_items SET session_id=NULL WHERE session_id=? AND tenant_id=?', ctx.params.id, ctx.t); run('DELETE FROM audit_sessions WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });
  router.post('/audit/audits/:id/items', need('audit', 'edit'), ctx => { const a = loadAudit(ctx, ctx.params.id); if (!ctx.body.question) throw bad('Write the question');
    return { id: insert('audit_items', { tenant_id: ctx.t, audit_id: a.id, ...pick(ctx.body, ['question', 'topic', 'expected_evidence', 'auditee', 'session_id'], ctx), control_id: filterControlIds(ctx, [ctx.body.control_id])[0] || null }) }; });
  router.post('/audit/audits/:id/assign-session', need('audit', 'edit'), ctx => { const a = loadAudit(ctx, ctx.params.id); const ids = (ctx.body.item_ids || []).map(Number); if (!ids.length) throw bad('Select questions first');
    run(`UPDATE audit_items SET session_id=? WHERE audit_id=? AND id IN (${inList(ids)})`, ctx.body.session_id || null, a.id); });
  // Fieldwork: record the answer; "No" raises a finding, "Yes, evidence to follow" raises a potential finding
  router.put('/audit/items/:id', need('audit', 'edit'), ctx => {
    const it = get('SELECT * FROM audit_items WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!it) throw notFound(); const b = ctx.body; const patch = pick(b, ['notes', 'auditee', 'session_id'], ctx);
    if (b.answer !== undefined) { if (!['pending', 'yes', 'no', 'partial', 'na'].includes(b.answer)) throw bad('Unknown answer'); Object.assign(patch, { answer: b.answer, answered_by: ctx.user.id, answered_at: new Date().toISOString() }); }
    if (b.evidence_pending !== undefined) patch.evidence_pending = b.evidence_pending ? 1 : 0;
    return tx(() => { update('audit_items', it.id, ctx.t, patch); const now = get('SELECT * FROM audit_items WHERE id=?', it.id); syncFinding(ctx, now);
      run(`UPDATE audits SET status='fieldwork' WHERE id=? AND status='planned'`, it.audit_id);
      return { ...now, finding_ref: get(`SELECT ref FROM findings WHERE audit_item_id=? AND status!='closed'`, it.id)?.ref || null }; });
  });
  router.delete('/audit/items/:id', need('audit', 'edit'), ctx => { run('DELETE FROM audit_items WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });

  // ── Findings and corrective actions ──
  router.get('/audit/findings', need('audit'), ctx => {
    const fs = all(`SELECT x.*, a.ref audit_ref, a.title audit_title, c.ref control_ref, f.code control_framework FROM findings x LEFT JOIN audits a ON a.id=x.audit_id
      LEFT JOIN controls c ON c.id=x.control_id LEFT JOIN frameworks f ON f.id=c.framework_id WHERE x.tenant_id=? ORDER BY x.id DESC`, ctx.t);
    const cs = all('SELECT * FROM capas WHERE tenant_id=? ORDER BY id', ctx.t);
    return fs.map(x => ({ ...x, capas: cs.filter(c => c.finding_id === x.id) }));
  });
  const FF = ['title', 'description', 'severity', 'finding_type', 'status', 'owner', 'due_date', 'audit_id'];
  router.post('/audit/findings', need('audit', 'edit'), ctx => { if (!ctx.body.title) throw bad('Give the finding a title'); return { id: insert('findings', { tenant_id: ctx.t, ref: nextRef(ctx.t, 'FND'), ...pick(ctx.body, FF, ctx), created_by: ctx.user.id }) }; });
  router.put('/audit/findings/:id', need('audit', 'edit'), ctx => {
    const f = get('SELECT * FROM findings WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!f) throw notFound();
    if (ctx.body.status === 'closed' && get(`SELECT 1 x FROM capas WHERE finding_id=? AND status!='verified'`, f.id)) throw bad('Verify every corrective action before closing the finding');
    update('findings', f.id, ctx.t, pick(ctx.body, FF, ctx)); log(ctx.t, ctx.user.id, 'update', 'finding', f.id, ctx.body.status || null);
  });
  router.post('/audit/findings/:id/capas', need('audit', 'edit'), ctx => { const f = get('SELECT id FROM findings WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!f) throw notFound(); if (!ctx.body.action) throw bad('Describe the corrective action');
    run(`UPDATE findings SET status='in_progress' WHERE id=? AND status='open'`, f.id);
    return { id: insert('capas', { tenant_id: ctx.t, finding_id: f.id, ...pick(ctx.body, ['action', 'owner', 'due_date'], ctx) }) }; });
  router.put('/audit/capas/:id', need('audit', 'edit'), ctx => { const d = pick(ctx.body, ['action', 'owner', 'due_date', 'status', 'verification_note'], ctx);
    if (d.status && !['open', 'done', 'verified'].includes(d.status)) throw bad('Unknown status'); update('capas', ctx.params.id, ctx.t, d); });
  router.delete('/audit/capas/:id', need('audit', 'edit'), ctx => { run('DELETE FROM capas WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });
};
