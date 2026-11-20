'use strict';
// Framework library, unified control map explorer, tenant-defined frameworks and mappings.
const { all, get, run, insert, tx, log, inList } = require('../db');
const { tenant, need } = require('../auth');
const { bad, notFound, forbidden } = require('../lib/http');
const csv = require('../lib/csv');
const coverage = require('../services/coverage');

const visibleFramework = (ctx, id) => { const f = get('SELECT * FROM frameworks WHERE id=? AND (tenant_id IS NULL OR tenant_id=?)', id, ctx.t); if (!f) throw notFound('Framework not found'); return f; };
const visibleControl = (ctx, id) => {
  const c = get(`SELECT c.*, f.code framework, f.name framework_name, f.library, f.tenant_id fw_tenant FROM controls c JOIN frameworks f ON f.id=c.framework_id
                 WHERE c.id=? AND (f.tenant_id IS NULL OR f.tenant_id=?)`, id, ctx.t);
  if (!c) throw notFound('Control not found'); return c;
};
// Keeps only control ids this tenant is allowed to reference.
const filterControlIds = (ctx, ids) => {
  const list = [...new Set((ids || []).map(Number).filter(Number.isFinite))]; if (!list.length) return [];
  return all(`SELECT c.id FROM controls c JOIN frameworks f ON f.id=c.framework_id WHERE c.id IN (${inList(list)}) AND (f.tenant_id IS NULL OR f.tenant_id=?)`, ctx.t).map(r => r.id);
};

module.exports = router => {
  router.get('/frameworks', tenant, ctx => all(`SELECT f.*, (SELECT count(*) FROM controls c WHERE c.framework_id=f.id) controls,
      (SELECT count(*) FROM controls c WHERE c.framework_id=f.id AND c.assessable=1) assessable,
      CASE WHEN tf.framework_id IS NULL THEN 0 ELSE 1 END adopted, tf.requirement
    FROM frameworks f LEFT JOIN tenant_frameworks tf ON tf.framework_id=f.id AND tf.tenant_id=?
    WHERE f.tenant_id IS NULL OR f.tenant_id=? ORDER BY f.library, f.sort, f.id`, ctx.t, ctx.t));

  router.get('/frameworks/:id/controls', tenant, ctx => {
    const f = visibleFramework(ctx, ctx.params.id);
    const q = (ctx.query.q || '').trim(); const fam = ctx.query.family || ''; const page = Math.max(0, Number(ctx.query.page) || 0); const size = 100;
    const where = ['c.framework_id=?']; const p = [f.id];
    if (q) { where.push('(c.ref LIKE ? OR c.title LIKE ? OR c.description LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (fam) { where.push('c.family=?'); p.push(fam); }
    if (ctx.query.assessable === '1') where.push('c.assessable=1');
    const total = get(`SELECT count(*) n FROM controls c WHERE ${where.join(' AND ')}`, ...p).n;
    const rows = all(`SELECT c.id,c.ref,c.title,substr(c.description,1,320) description,c.family,c.record_type,c.assessable,c.level,c.applicable_role,
        (SELECT count(*) FROM control_links l WHERE l.a_id=c.id AND l.tenant_id IN (0,?)) links
      FROM controls c WHERE ${where.join(' AND ')} ORDER BY c.sort LIMIT ${size} OFFSET ${page * size}`, ctx.t, ...p);
    return { framework: f, total, page, size, rows, families: all('SELECT family, count(*) n FROM controls WHERE framework_id=? GROUP BY family ORDER BY min(sort)', f.id) };
  });

  // Picker search across the frameworks a tenant can see
  router.get('/controls/search', tenant, ctx => {
    const q = (ctx.query.q || '').trim(); const fw = Number(ctx.query.framework_id) || null;
    const where = ['(f.tenant_id IS NULL OR f.tenant_id=?)', 'c.assessable=1']; const p = [ctx.t];
    if (fw) { where.push('c.framework_id=?'); p.push(fw); }
    if (ctx.query.adopted === '1') { where.push('c.framework_id IN (SELECT framework_id FROM tenant_frameworks WHERE tenant_id=?)'); p.push(ctx.t); }
    if (q) { where.push('(c.ref LIKE ? OR c.title LIKE ? OR c.description LIKE ?)'); p.push(`${q}%`, `%${q}%`, `%${q}%`); }
    // Best matches first: control ID, then frameworks in the organisation's scope, then title matches
    return all(`SELECT c.id,c.ref,c.title,substr(c.description,1,200) description,f.code framework FROM controls c JOIN frameworks f ON f.id=c.framework_id
                WHERE ${where.join(' AND ')}
                ORDER BY (c.ref LIKE ?) DESC, (c.framework_id IN (SELECT framework_id FROM tenant_frameworks WHERE tenant_id=?)) DESC, (c.title LIKE ?) DESC,
                         CASE f.library WHEN 'CUSTOM' THEN 0 WHEN 'CYS' THEN 1 ELSE 2 END, f.sort, c.sort LIMIT 40`, ...p, `${q}%`, ctx.t, `%${q}%`);
  });
  router.post('/controls/lookup', tenant, ctx => {
    const ids = filterControlIds(ctx, ctx.body.ids);
    return ids.length ? all(`SELECT c.id,c.ref,c.title,f.code framework FROM controls c JOIN frameworks f ON f.id=c.framework_id WHERE c.id IN (${inList(ids)})`) : [];
  });

  // Control detail: text, the map rows it starts, every equivalent control, and this tenant's compliance position
  router.get('/controls/:id', tenant, ctx => {
    const c = visibleControl(ctx, ctx.params.id);
    const links = all(`SELECT l.confidence, l.tenant_id, c.id, c.ref, c.title, f.code framework, f.id framework_id, f.region,
        CASE WHEN tf.framework_id IS NULL THEN 0 ELSE 1 END adopted
      FROM control_links l JOIN controls c ON c.id=l.b_id JOIN frameworks f ON f.id=c.framework_id
      LEFT JOIN tenant_frameworks tf ON tf.framework_id=f.id AND tf.tenant_id=?
      WHERE l.a_id=? AND l.tenant_id IN (0,?) ORDER BY f.library, f.sort, c.sort`, ctx.t, c.id, ctx.t);
    const rows = all('SELECT cryptika_id,row_type,confidence,ai_description,notes,members FROM map_rows WHERE start_control_id=? ORDER BY id', c.id)
      .map(r => ({ ...r, members: JSON.parse(r.members) }));
    return { control: c, links, map_rows: rows, position: c.assessable ? coverage.explain(ctx.t, c.id) : null };
  });

  // ── Control map explorer ──
  // Bird's-eye view: every framework and how many mapped relationships join each pair
  let pairCache = null;
  router.get('/graph/overview', tenant, ctx => {
    const pairSql = `SELECT ca.framework_id a, cb.framework_id b, count(*) n, sum(l.confidence != 'Partial') direct FROM control_links l
      JOIN controls ca ON ca.id=l.a_id JOIN controls cb ON cb.id=l.b_id WHERE l.tenant_id=? AND ca.framework_id < cb.framework_id GROUP BY 1, 2`;
    if (!pairCache) pairCache = all(pairSql, 0);
    const merged = new Map(pairCache.map(e => [e.a + '|' + e.b, { ...e }]));
    for (const e of all(pairSql, ctx.t)) { const k = e.a + '|' + e.b; const m = merged.get(k); if (m) { m.n += e.n; m.direct += e.direct; } else merged.set(k, { ...e }); }
    return {
      frameworks: all(`SELECT f.id, f.code, f.name, f.library, f.region, (SELECT count(*) FROM controls c WHERE c.framework_id=f.id AND c.assessable=1) controls,
          CASE WHEN tf.framework_id IS NULL THEN 0 ELSE 1 END adopted FROM frameworks f LEFT JOIN tenant_frameworks tf ON tf.framework_id=f.id AND tf.tenant_id=?
        WHERE f.tenant_id IS NULL OR f.tenant_id=? ORDER BY f.library, f.sort, f.id`, ctx.t, ctx.t),
      edges: [...merged.values()],
    };
  });
  // One control with everything tied to it: equivalent controls and this organisation's own records
  router.get('/graph/control/:id', tenant, ctx => {
    const c = visibleControl(ctx, ctx.params.id); const t = ctx.t;
    const links = all(`SELECT l.confidence, CASE WHEN l.tenant_id=0 THEN 0 ELSE 1 END own, c.id, c.ref, c.title, f.code framework, f.id framework_id, f.region, f.library,
        (SELECT count(*) FROM control_links x WHERE x.a_id=c.id AND x.tenant_id IN (0,?)) degree
      FROM control_links l JOIN controls c ON c.id=l.b_id JOIN frameworks f ON f.id=c.framework_id WHERE l.a_id=? AND l.tenant_id IN (0,?) ORDER BY f.library, f.sort, c.sort`, t, c.id, t);
    const records = [
      ...all(`SELECT DISTINCT p.id, p.ref, p.title, p.status FROM policies p WHERE p.tenant_id=? AND p.status != 'retired' AND (p.id IN (SELECT pc.policy_id FROM policy_clauses pc JOIN clause_controls cc ON cc.clause_id=pc.id WHERE cc.control_id=?)
                OR p.id IN (SELECT policy_id FROM policy_driver_controls WHERE control_id=?))`, t, c.id, c.id).map(p => ({ kind: 'policy', key: 'policy-' + p.id, label: p.ref, title: p.title, status: p.status, href: '#/policies/' + p.id })),
      ...all(`SELECT DISTINCT r.id, r.ref, r.title, i.assessment_id FROM risk_item_controls rc JOIN risk_assessment_items i ON i.id=rc.item_id JOIN risks r ON r.id=i.risk_id WHERE rc.tenant_id=? AND rc.control_id=?`, t, c.id)
        .map(r => ({ kind: 'risk', key: 'risk-' + r.id, label: r.ref, title: r.title, status: 'treated by this control', href: '#/risk/assessments/' + r.assessment_id })),
      ...all(`SELECT gi.id, gi.status, ga.id assessment_id, ga.ref FROM gap_items gi JOIN gap_assessments ga ON ga.id=gi.assessment_id WHERE gi.tenant_id=? AND gi.control_id=?`, t, c.id)
        .map(g => ({ kind: 'evidence', key: 'evidence-' + g.id, label: g.ref, title: 'Implementation evidence', status: g.status, href: '#/compliance/gaps/' + g.assessment_id })),
      ...all(`SELECT q.id, q.question, q.topic FROM audit_questions q JOIN audit_question_controls qc ON qc.question_id=q.id WHERE q.tenant_id=? AND qc.control_id=?`, t, c.id)
        .map(q => ({ kind: 'question', key: 'question-' + q.id, label: 'Audit question', title: q.question, status: q.topic || '', href: '#/audit/questions' })),
    ];
    return { node: { id: c.id, ref: c.ref, title: c.title, description: c.description, framework: c.framework, framework_id: c.framework_id, assessable: c.assessable, degree: links.length },
      links, records, position: c.assessable ? coverage.explain(t, c.id) : null };
  });

  // Tenant's own mapping between two controls (affects this tenant only)
  router.post('/controls/:id/links', need('frameworks', 'manage'), ctx => {
    const a = visibleControl(ctx, ctx.params.id); const b = visibleControl(ctx, ctx.body.target_id);
    if (a.framework_id === b.framework_id) throw bad('Controls of the same framework are not mapped to each other');
    if (get('SELECT 1 x FROM control_links WHERE a_id=? AND b_id=? AND tenant_id IN (0,?)', a.id, b.id, ctx.t)) throw bad('These two controls are already mapped');
    tx(() => { for (const [x, y] of [[a.id, b.id], [b.id, a.id]]) run('INSERT INTO control_links (a_id,b_id,confidence,tenant_id) VALUES (?,?,?,?)', x, y, 'Tenant', ctx.t); });
    log(ctx.t, ctx.user.id, 'mapping.add', 'control', a.id, `${a.framework} ${a.ref} ↔ ${b.framework} ${b.ref}`);
  });
  router.delete('/controls/:id/links/:target', need('frameworks', 'manage'), ctx => {
    run('DELETE FROM control_links WHERE tenant_id=? AND ((a_id=? AND b_id=?) OR (a_id=? AND b_id=?))', ctx.t, ctx.params.id, ctx.params.target, ctx.params.target, ctx.params.id);
    log(ctx.t, ctx.user.id, 'mapping.remove', 'control', Number(ctx.params.id), null);
  });

  // Tenant-defined frameworks
  router.post('/frameworks', need('frameworks', 'manage'), ctx => {
    const { code, name, description } = ctx.body; if (!code || !name) throw bad('Short code and name are required');
    if (get('SELECT 1 x FROM frameworks WHERE code=? AND (tenant_id IS NULL OR tenant_id=?)', code, ctx.t)) throw bad('A framework with this short code already exists');
    const id = insert('frameworks', { tenant_id: ctx.t, code, name, description, library: 'CUSTOM', region: 'Own framework', sort: 999 });
    run('INSERT INTO tenant_frameworks (tenant_id, framework_id, requirement, basis, added_by) VALUES (?,?,?,?,?)', ctx.t, id, 'voluntary', 'Own framework', ctx.user.id);
    log(ctx.t, ctx.user.id, 'create', 'framework', id, code); return { id };
  });
  router.delete('/frameworks/:id', need('frameworks', 'manage'), ctx => {
    const f = visibleFramework(ctx, ctx.params.id); if (f.tenant_id !== ctx.t) throw forbidden('Library frameworks cannot be deleted');
    const used = get(`SELECT (SELECT count(*) FROM clause_controls cc JOIN controls c ON c.id=cc.control_id WHERE c.framework_id=?) +
                             (SELECT count(*) FROM gap_assessments WHERE framework_id=?) + (SELECT count(*) FROM audits WHERE framework_id=?) n`, f.id, f.id, f.id).n;
    if (used) throw bad('This framework is referenced by policies, gap assessments or audits');
    tx(() => {
      run(`DELETE FROM control_links WHERE tenant_id=? AND (a_id IN (SELECT id FROM controls WHERE framework_id=?) OR b_id IN (SELECT id FROM controls WHERE framework_id=?))`, ctx.t, f.id, f.id);
      run('DELETE FROM controls WHERE framework_id=?', f.id); run('DELETE FROM tenant_frameworks WHERE framework_id=?', f.id); run('DELETE FROM frameworks WHERE id=?', f.id);
    });
  });
  router.get('/frameworks-template', tenant, ctx => {
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="framework-import-template.csv"' });
    ctx.res.end(csv.stringify(['Control ID', 'Title', 'Description', 'Family', 'Maps To'], [
      ['POL-01', 'Information security policy', 'A policy approved by management is published and communicated.', 'Policy', 'ISO 27001:2022|A.5.1; NIST CSF 2.0|GV.PO-01'],
      ['ACC-01', 'User access reviews', 'Access rights are reviewed at least every six months.', 'Access', 'ISO 27001:2022|A.5.18'],
    ]));
  });
  // Import controls (and optional mappings) into an own framework from CSV
  router.post('/frameworks/:id/import', need('frameworks', 'manage'), ctx => {
    const f = visibleFramework(ctx, ctx.params.id); if (f.tenant_id !== ctx.t) throw forbidden('Controls can only be imported into your own frameworks');
    const { records } = csv.parseObjects(String(ctx.body.csv || ''));
    if (!records.length) throw bad('The file has no rows. Use the template columns: Control ID, Title, Description, Family, Maps To');
    const fwByCode = Object.fromEntries(all('SELECT id, code FROM frameworks WHERE tenant_id IS NULL OR tenant_id=?', ctx.t).map(x => [x.code.toLowerCase(), x.id]));
    const report = { created: 0, updated: 0, links: 0, problems: [] };
    tx(() => {
      let sort = get('SELECT ifnull(max(sort),0) m FROM controls WHERE framework_id=?', f.id).m;
      records.forEach((r, i) => {
        const ref = r.control_id || r.id || r.ref; if (!ref) { report.problems.push(`Row ${i + 2}: no Control ID`); return; }
        let c = get('SELECT id FROM controls WHERE framework_id=? AND ref=?', f.id, ref);
        if (c) { run('UPDATE controls SET title=?, description=?, family=? WHERE id=?', r.title || null, r.description || null, r.family || null, c.id); report.updated++; }
        else { c = { id: insert('controls', { framework_id: f.id, ref, title: r.title || null, description: r.description || null, family: r.family || null, record_type: 'OPERATIVE', assessable: 1, sort: ++sort }) }; report.created++; }
        for (const m of (r.maps_to || '').split(';').map(s => s.trim()).filter(Boolean)) {
          const [code, tref] = m.split('|').map(s => s.trim()); const fid = fwByCode[(code || '').toLowerCase()];
          const target = fid && tref ? get('SELECT id FROM controls WHERE framework_id=? AND ref=?', fid, tref) : null;
          if (!target) { report.problems.push(`Row ${i + 2}: mapping "${m}" not found`); continue; }
          if (fid === f.id) continue;
          if (!get('SELECT 1 x FROM control_links WHERE a_id=? AND b_id=? AND tenant_id=?', c.id, target.id, ctx.t)) {
            run('INSERT INTO control_links (a_id,b_id,confidence,tenant_id) VALUES (?,?,?,?)', c.id, target.id, 'Tenant', ctx.t);
            run('INSERT INTO control_links (a_id,b_id,confidence,tenant_id) VALUES (?,?,?,?)', target.id, c.id, 'Tenant', ctx.t); report.links++;
          }
        }
      });
    });
    log(ctx.t, ctx.user.id, 'framework.import', 'framework', f.id, `${report.created} created, ${report.updated} updated, ${report.links} mappings`);
    return report;
  });
};
module.exports.filterControlIds = filterControlIds;
module.exports.visibleControl = visibleControl;
module.exports.visibleFramework = visibleFramework;
