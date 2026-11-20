'use strict';
// Creates an organisation from an import package (JSON): profile, assets, threats, vulnerabilities, threat links,
// risks and scored risk assessments. Packages are produced from a risk-assessment workbook by
// tools/ra_workbook_to_package.py. Importing is all-or-nothing and never touches another organisation.
const fs = require('node:fs');
const path = require('node:path');
const { all, get, run, insert, tx, nextRef, log, meta, DATA_DIR } = require('../db');
const { provisionTenant } = require('../db/seed-defaults');
const { bad } = require('../lib/http');

const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organisation';

function importPackage(pkg, userId) {
  if (!pkg || !pkg.organisation || !pkg.organisation.name) throw bad('This file is not a GRC Hub company package');
  const org = pkg.organisation; const slug = slugOf(org.name);
  if (get('SELECT 1 x FROM tenants WHERE slug=?', slug)) throw bad(`An organisation named "${org.name}" already exists`);
  return tx(() => {
    const { tenantId: T } = provisionTenant(org.name, slug);
    run(`UPDATE company_profile SET legal_name=?, sector=?, country=?, size=?, description=?, updated_at=datetime('now') WHERE tenant_id=?`, org.name, org.sector || null, org.country || null, org.size || null, org.description || null, T);
    require('../routes/governance').syncMandatory(T, userId);
    const fw = code => get('SELECT id FROM frameworks WHERE code=? AND tenant_id IS NULL', code)?.id;
    for (const code of pkg.frameworks || []) if (fw(code)) run(`INSERT INTO tenant_frameworks (tenant_id,framework_id,requirement,basis,added_by) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`, T, fw(code), 'voluntary', 'Referenced by the risk assessment', userId);

    const cat = {}; for (const c of pkg.categories || []) cat[c.name] = insert('vuln_categories', { tenant_id: T, name: c.name, description: c.description || null, keywords: '' });
    const asset = {}; for (const a of pkg.assets || []) asset[a.key] = insert('assets', { tenant_id: T, ref: nextRef(T, 'AST'), name: a.name, asset_type: a.asset_type, ip_address: a.ip_address, hostname: a.hostname,
      criticality: a.criticality, description: a.description, source: 'import' });
    const threat = {}; for (const t of pkg.threats || []) threat[t.key] = insert('threats', { tenant_id: T, ref: t.ref || nextRef(T, 'THR'), name: t.name, category: t.category, description: t.description, source: 'import' });
    let links = 0;
    for (const v of pkg.vulnerabilities || []) {
      if (!asset[v.asset]) throw bad(`Vulnerability "${v.title}" refers to an unknown asset`);
      const id = insert('vulnerabilities', { tenant_id: T, ref: nextRef(T, 'VUL'), asset_id: asset[v.asset], title: v.title, severity: v.severity, cve: v.cve, category_id: cat[v.category] || null,
        description: v.description, solution: v.solution, source: v.source || 'import' });
      if (v.threat && threat[v.threat]) { insert('threat_mappings', { tenant_id: T, threat_id: threat[v.threat], vulnerability_id: id }); links++; }
    }
    const risk = {}; for (const r of pkg.risks || []) risk[r.key] = insert('risks', { tenant_id: T, ref: r.ref || nextRef(T, 'RSK'), title: r.title, description: r.description, risk_type: r.risk_type === 'business' ? 'business' : 'cyber',
      category: r.category, threat_id: r.threat ? threat[r.threat] || null : null, status: 'registered', created_by: userId });
    // Reference codes name a control; ECC codes are looked up in the current edition first.
    const editions = { 'NCA ECC': ['NCA ECC-2:2024', 'NCA ECC-1:2018'] };
    const control = (framework, ref) => { for (const code of editions[framework] || [framework]) { const c = get('SELECT c.id FROM controls c JOIN frameworks f ON f.id=c.framework_id WHERE f.code=? AND f.tenant_id IS NULL AND c.ref=?', code, ref); if (c) return c.id; } return null; };
    const appetite = Number(JSON.parse(get('SELECT settings FROM tenants WHERE id=?', T).settings || '{}').risk_appetite) || 6;
    let items = 0, controls = 0; const unmatched = new Set(); const mismatches = [];
    for (const a of pkg.assessments || []) {
      const aid = insert('risk_assessments', { tenant_id: T, ref: nextRef(T, 'RA'), name: a.name, purpose: a.purpose, basis: a.basis, appetite, created_by: userId });
      for (const it of a.items || []) {
        if (!risk[it.risk]) throw bad(`Assessment "${a.name}" refers to an unknown risk`);
        const iid = insert('risk_assessment_items', { tenant_id: T, assessment_id: aid, risk_id: risk[it.risk], likelihood: it.likelihood, impact: it.impact, notes: it.notes, treatment: it.treatment || null,
          treatment_plan: it.treatment_plan, treatment_owner: it.treatment_owner }); items++;
        let reduction = 0; const seen = new Set();
        for (const c of it.controls || []) { const cid = control(c.framework, c.ref); if (!cid) { unmatched.add(`${c.framework} ${c.ref}`); continue; } if (seen.has(cid)) continue; seen.add(cid);
          insert('risk_item_controls', { tenant_id: T, item_id: iid, control_id: cid }); controls++; }
        if (it.existing_control) { insert('risk_item_controls', { tenant_id: T, item_id: iid, custom_control: it.existing_control.text, effectiveness: it.existing_control.effectiveness, effectiveness_source: 'user' }); reduction = it.existing_control.effectiveness * 5; }
        // The scores the application will show must equal the scores in the source
        if (it.expect) { const inherent = it.likelihood * it.impact; const residual = it.existing_control && it.treatment ? Math.max(1, Math.round((inherent - reduction) * 10) / 10) : inherent;
          if (Math.abs(inherent - it.expect.inherent) > 0.001 || Math.abs(residual - it.expect.residual) > 0.001) mismatches.push(it.source_ref || it.risk); }
      }
    }
    if (mismatches.length) throw bad(`Scores would not match the source for: ${mismatches.join(', ')}`);
    const summary = { organisation: org.name, tenant_id: T, assets: Object.keys(asset).length, threats: Object.keys(threat).length, vulnerabilities: (pkg.vulnerabilities || []).length, threat_links: links,
      risks: Object.keys(risk).length, assessments: (pkg.assessments || []).length, assessment_items: items, control_links: controls, unmatched_control_codes: [...unmatched].sort() };
    log(T, userId, 'organisation.import', 'tenant', T, JSON.stringify({ ...summary, unmatched_control_codes: summary.unmatched_control_codes.length }));
    return summary;
  });
}
// Imports every package placed in data/imports that has not been imported yet (runs at start-up).
function importPending() {
  const dir = path.join(DATA_DIR, 'imports'); if (!fs.existsSync(dir)) return;
  const admin = get('SELECT id FROM users WHERE is_platform_admin=1 ORDER BY id')?.id || null;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    if (meta.get('import:' + file)) continue;
    try { const s = importPackage(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), admin); meta.set('import:' + file, new Date().toISOString());
      console.log(`  Imported "${s.organisation}": ${s.assets} assets, ${s.vulnerabilities} vulnerabilities, ${s.threats} threats, ${s.risks} risks in ${s.assessments} assessments`); }
    catch (e) { if (/already exists/.test(e.message)) meta.set('import:' + file, 'exists'); else console.error(`  Could not import ${file}: ${e.message}`); }
  }
}
module.exports = { importPackage, importPending };
