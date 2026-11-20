'use strict';
// First-run data: the platform administrator and one demonstration organisation so every screen has
// something to show. Set GRC_NO_DEMO=1 before the first start to create only the platform administrator.
const { all, get, run, insert, tx, meta, nextRef } = require('./index');
const { hashPassword } = require('../auth');
const { provisionTenant } = require('./seed-defaults');

const DEMO_PASSWORD = 'Cryptika#2026';

function seedDemo() {
  if (meta.get('demo_version')) return;
  // Route modules register their workflow hooks when loaded; the demo uses the same engine as the application.
  const workflow = require('../services/workflow');
  const { syncMandatory } = require('../routes/governance');
  require('../routes/risk');
  tx(() => {
    insert('users', { tenant_id: null, email: 'admin@cryptika.local', name: 'Cryptika Platform Admin', password_hash: hashPassword(DEMO_PASSWORD), is_platform_admin: 1 });
    meta.set('demo_version', '1');
    if (process.env.GRC_NO_DEMO === '1') return;

    const { tenantId: T, roleId } = provisionTenant('Al Manara Insurance (Demo)', 'al-manara-demo');
    const dept = Object.fromEntries(all('SELECT id, name FROM departments WHERE tenant_id=?', T).map(d => [d.name, d.id]));
    const pw = hashPassword(DEMO_PASSWORD);
    const mk = (email, name, role, department, job_title) => { const id = insert('users', { tenant_id: T, email, name, password_hash: pw, role_id: roleId[role], department_id: dept[department], job_title }); return { id, name, role_id: roleId[role], tenant_id: T, department_id: dept[department], permissions: {} }; };
    const U = {
      admin: mk('admin@almanara.demo', 'Dana Haddad', 'Tenant Administrator', 'Information Technology', 'GRC Platform Owner'),
      ciso: mk('ciso@almanara.demo', 'Omar Khalil', 'CISO', 'Information Security', 'Chief Information Security Officer'),
      compliance: mk('compliance@almanara.demo', 'Lina Saleh', 'Compliance Manager', 'Compliance', 'Compliance Manager'),
      risk: mk('risk@almanara.demo', 'Yousef Nasser', 'Risk Manager', 'Risk Management', 'Risk Manager'),
      auditor: mk('auditor@almanara.demo', 'Rania Aziz', 'Internal Auditor', 'Internal Audit', 'Senior Internal Auditor'),
      reviewer: mk('reviewer@almanara.demo', 'Tariq Mansour', 'Technical Reviewer', 'Information Security', 'Security Engineer'),
      writer: mk('writer@almanara.demo', 'Sara Qasem', 'Policy Writer', 'Compliance', 'Compliance Analyst'),
      it: mk('it@almanara.demo', 'Fadi Barakat', 'Control Owner', 'Information Technology', 'IT Operations Manager'),
      hr: mk('hr@almanara.demo', 'Maha Zureikat', 'Control Owner', 'Human Resources', 'HR Manager'),
    };
    run(`UPDATE company_profile SET legal_name=?, sector='Insurance', country='Jordan', size='201–500 employees', description=?, mission=?, vision=?, business_objectives=?, cyber_objectives=?, updated_at=datetime('now') WHERE tenant_id=?`,
      'Al Manara Insurance Company (demonstration data)', 'General insurer offering motor, medical and property cover through branches, brokers and an online customer portal.',
      'Protect our customers against loss with fair, fast and dependable insurance.', 'To be the most trusted insurer in the Levant.',
      'Grow digital sales to 40% of new policies; settle 90% of motor claims within five working days.',
      'Meet Central Bank of Jordan cybersecurity requirements; no reportable personal-data breach; restore core systems within four hours.', T);
    syncMandatory(T, U.admin.id);
    const fw = code => get('SELECT id FROM frameworks WHERE code=? AND tenant_id IS NULL', code).id;
    const ctl = (code, ref) => get('SELECT id FROM controls WHERE framework_id=? AND ref=?', fw(code), ref)?.id;
    const ISO = 'ISO 27001:2022';
    insert('tenant_frameworks', { tenant_id: T, framework_id: fw(ISO), requirement: 'voluntary', basis: 'Management decision to certify the ISMS', added_by: U.ciso.id });

    for (const [name, description, owner, d, crit] of [
      ['Motor insurance underwriting', 'Quotation, risk acceptance and policy issuance for motor cover.', 'Head of Motor', 'Operations', 4],
      ['Claims handling', 'Registration, assessment, approval and payment of claims.', 'Head of Claims', 'Operations', 5],
      ['Customer onboarding', 'Identity verification and creation of the customer record.', 'Head of Customer Service', 'Operations', 4],
      ['Premium collection', 'Invoicing and collection of premiums through banks and the portal.', 'Finance Manager', 'Finance', 4]])
      insert('business_processes', { tenant_id: T, ref: nextRef(T, 'BP'), name, description, owner, department_id: dept[d], criticality: crit });
    const com = insert('committees', { tenant_id: T, name: 'Information Security Steering Committee', purpose: 'Sets direction, approves policies and reviews risk and compliance posture.', meeting_frequency: 'Quarterly' });
    for (const [u, r] of [[U.ciso, 'Chair'], [U.compliance, 'Member'], [U.risk, 'Member'], [U.it, 'Member']]) insert('committee_members', { tenant_id: T, committee_id: com, user_id: u.id, committee_role: r });

    // Policies
    const policy = (p, clauses, drivers = []) => {
      const id = insert('policies', { tenant_id: T, ref: nextRef(T, 'POL'), doc_type: 'Policy', version: '1.0', driver_framework_id: fw(ISO), updated_at: new Date().toISOString(), ...p });
      drivers.map(r => ctl(ISO, r)).filter(Boolean).forEach(c => run('INSERT OR IGNORE INTO policy_driver_controls VALUES (?,?)', id, c));
      clauses.forEach(([text, refs], i) => { const cid = insert('policy_clauses', { policy_id: id, number: String(i + 1), text, sort: i });
        refs.map(r => ctl(ISO, r)).filter(Boolean).forEach(c => run('INSERT OR IGNORE INTO clause_controls VALUES (?,?)', cid, c)); });
      return id;
    };
    const pub = { status: 'published', published_at: new Date().toISOString(), owner_id: U.ciso.id, created_by: U.writer.id };
    policy({ ...pub, title: 'Information Security Policy', category: 'Governance', purpose: 'Sets management direction and support for information security in line with business requirements, laws and regulations.',
      scope: 'All employees, contractors, systems and locations of Al Manara Insurance.', summary: 'Top-level policy of the information security management system.', review_date: '2027-06-30' }, [
      ['Management approves this policy, publishes it to all staff and relevant third parties, and reviews it at least once a year or after a significant change.', ['A.5.1', '5.2']],
      ['Information security roles and responsibilities are defined, assigned and communicated.', ['A.5.2', '5.3']],
      ['Conflicting duties are separated so that no single person can misuse company assets undetected.', ['A.5.3']],
      ['All staff receive security awareness training when they join and every year after that.', ['A.6.3', '7.3']]], ['A.5.1']);
    policy({ ...pub, title: 'Acceptable Use Policy', category: 'Human resources', purpose: 'Defines how company information and equipment may be used.',
      scope: 'Everyone who uses Al Manara information or IT equipment.', summary: 'Rules for acceptable use of information and associated assets.', review_date: '2027-03-31' }, [
      ['Company information and equipment are used for business purposes; limited personal use must not interfere with work or breach any policy.', ['A.5.10']],
      ['Users lock their screens when leaving their desk and keep confidential paper and removable media locked away.', ['A.7.7']],
      ['Removable storage media may be used only when issued and encrypted by IT.', ['A.7.10']],
      ['Users must not install software or disable security tools on company devices.', ['A.8.1', 'A.8.19']]], ['A.5.10']);
    const acp = policy({ status: 'draft', owner_id: U.ciso.id, created_by: U.writer.id, title: 'Access Control Policy', category: 'Access management', purpose: 'Ensures access to information and systems is authorised and restricted to what each role needs.',
      scope: 'All business applications, infrastructure and cloud services.', summary: 'Rules for granting, reviewing and revoking access.' }, [
      ['Access is granted on a least-privilege, need-to-know basis and approved by the information owner.', ['A.5.15']],
      ['Each user has a unique identity; shared accounts are not permitted.', ['A.5.16']],
      ['Access rights are reviewed every six months and removed on the day employment ends.', ['A.5.18']],
      ['Privileged access is limited, separately approved and logged.', ['A.8.2']],
      ['Multi-factor authentication is required for remote access and for all administrator accounts.', ['A.8.5']]], ['A.5.15']);
    run(`UPDATE policies SET status='in_review' WHERE id=?`, acp);
    workflow.start(T, U.writer, 'policy', acp, 'POL-0003 Access Control Policy');
    policy({ status: 'draft', owner_id: U.it.id, created_by: U.writer.id, title: 'Backup and Restore Policy', category: 'IT operations', purpose: 'Protects against loss of data.', scope: 'All production systems.' }, [
      ['Backups of information, software and system images are taken daily and tested by restoring a sample every quarter.', ['A.8.13']]]);

    // Risk data
    const asset = (name, asset_type, crit, extra = {}) => insert('assets', { tenant_id: T, ref: nextRef(T, 'AST'), name, asset_type, criticality: crit, owner: 'IT Operations Manager', department_id: dept['Information Technology'], ...extra });
    const A = { core: asset('Core insurance system', 'Application', 5, { hostname: 'core-app01' }), portal: asset('Customer portal', 'Application', 5, { hostname: 'portal.almanara.demo' }),
      db: asset('Claims database server', 'Server', 5, { ip_address: '10.10.20.15', hostname: 'claims-db01' }), fwall: asset('Head-office firewall', 'Network device', 4, { ip_address: '10.10.0.1' }),
      laptops: asset('Employee laptops', 'Endpoint', 3) };
    const threat = n => { const l = get('SELECT * FROM threat_library WHERE name=?', n); return insert('threats', { tenant_id: T, ref: nextRef(T, 'THR'), name: l.name, category: l.category, description: l.description, source: 'library' }); };
    const TH = { ransom: threat('Ransomware attack'), breach: threat('Personal data breach'), web: threat('Web application attack'), usb: threat('Malware via removable media'), fraud: threat('Payment and claims fraud') };
    const cat = n => get('SELECT id FROM vuln_categories WHERE name LIKE ?', n + '%').id;
    const vuln = (asset_id, title, severity, c, cvss) => insert('vulnerabilities', { tenant_id: T, ref: nextRef(T, 'VUL'), asset_id, title, severity, cvss, category_id: cat(c), source: 'manual' });
    const V = { patch: vuln(A.db, 'Operating system security updates more than 90 days overdue', 'High', 'Missing patches', 8.1), tls: vuln(A.portal, 'TLS 1.0 and weak cipher suites enabled', 'Medium', 'Cryptographic', 5.9),
      sqli: vuln(A.portal, 'SQL injection in the claims search form', 'Critical', 'Injection', 9.8), usb: vuln(A.laptops, 'USB storage ports enabled on all laptops', 'Medium', 'Security misconfiguration', 5.0),
      admin: vuln(A.fwall, 'Default administrator account still active', 'High', 'Authentication', 8.8) };
    for (const [t, c] of [[TH.ransom, 'Missing patches'], [TH.ransom, 'Authentication'], [TH.web, 'Injection'], [TH.breach, 'Cryptographic'], [TH.usb, 'Security misconfiguration']]) insert('threat_mappings', { tenant_id: T, threat_id: t, category_id: cat(c) });
    const risk = (o) => insert('risks', { tenant_id: T, ref: nextRef(T, 'RSK'), status: 'registered', created_by: U.risk.id, owner_id: U.risk.id, ...o });
    const R = [
      risk({ risk_type: 'cyber', title: 'Ransomware encrypts the claims database through unpatched server software', category: 'Malware', threat_id: TH.ransom, vulnerability_id: V.patch, asset_id: A.db }),
      risk({ risk_type: 'cyber', title: 'Customer data stolen through SQL injection in the customer portal', category: 'Technical', threat_id: TH.web, vulnerability_id: V.sqli, asset_id: A.portal }),
      risk({ risk_type: 'cyber', title: 'Malware introduced through USB storage on employee laptops', category: 'Malware', threat_id: TH.usb, vulnerability_id: V.usb, asset_id: A.laptops }),
      risk({ risk_type: 'business', title: 'Staged motor accidents lead to fraudulent claims', category: 'Fraud', description: 'Organised groups stage accidents or swap the named driver to obtain claim payments.' }),
    ];
    const ra = insert('risk_assessments', { tenant_id: T, ref: nextRef(T, 'RA'), name: 'Annual cyber risk assessment 2026', purpose: 'Yearly assessment required by the ISMS and the Central Bank of Jordan.', basis: 'Management instruction', appetite: 6, created_by: U.risk.id });
    const item = (risk_id, l, i, treatment, plan, ctrls) => { const id = insert('risk_assessment_items', { tenant_id: T, assessment_id: ra, risk_id, likelihood: l, impact: i, treatment, treatment_plan: plan });
      ctrls.forEach(([ref, custom, eff, src]) => insert('risk_item_controls', { tenant_id: T, item_id: id, control_id: ref ? ctl(ISO, ref) : null, custom_control: custom, effectiveness: eff, effectiveness_source: src })); };
    item(R[0], 4, 5, 'mitigate', 'Patch within 14 days; immutable backups; restore test every quarter.', [['A.8.8', null, 2, 'user'], ['A.8.13', null, 1, 'user']]);
    item(R[1], 4, 5, 'mitigate', 'Fix the injection flaw; add secure-coding review and a web application firewall.', [['A.8.28', null, 2, 'user']]);
    item(R[2], 3, 4, 'avoid', 'Disable USB storage on all laptops through endpoint management.', [[null, 'Disable USB mass-storage on all endpoints', 2.5, 'user']]);
    insert('risk_assessment_items', { tenant_id: T, assessment_id: ra, risk_id: R[3] });

    // Gap assessment for the mandatory CBJ catalogue, part-way through
    const cbj = fw('CBJ Non-Banking'); const ai = require('../services/ai'); const depts = all('SELECT id, name FROM departments WHERE tenant_id=?', T);
    const ga = insert('gap_assessments', { tenant_id: T, ref: nextRef(T, 'GAP'), name: 'CBJ Non-Banking — implementation evidence 2026', framework_id: cbj, status: 'in_progress', due_date: '2026-12-15', created_by: U.compliance.id });
    all('SELECT id, title, description FROM controls WHERE framework_id=? AND assessable=1 ORDER BY sort', cbj).forEach((c, n) => {
      const d = ai.suggestDepartment(c, depts);
      const base = { tenant_id: T, assessment_id: ga, control_id: c.id, suggested_department_id: d, department_id: d, evidence_guidance: ai.evidenceGuidance(c), status: 'requested' };
      if (n < 5) Object.assign(base, { status: 'valid', response_note: 'Configuration export and screenshots attached to the shared evidence folder.', submitted_by: U.it.id, submitted_at: '2026-11-02T09:00:00Z', reviewed_by: U.compliance.id, reviewed_at: '2026-11-04T10:00:00Z', reviewer_note: 'Evidence checked against the requirement.' });
      else if (n < 8) Object.assign(base, { status: 'submitted', response_note: 'See attached procedure and last quarterly report.', submitted_by: U.it.id, submitted_at: '2026-11-08T08:30:00Z' });
      else if (n === 8) Object.assign(base, { status: 'invalid', response_note: 'Screenshot attached.', submitted_by: U.it.id, submitted_at: '2026-11-05T08:30:00Z', reviewed_by: U.compliance.id, reviewed_at: '2026-11-06T10:00:00Z', reviewer_note: 'The screenshot shows the test environment. Please provide the production configuration.' });
      insert('gap_items', base);
    });

    // Audit question pool (starter examples; the full pool is imported from the Cryptika RCM workbooks)
    const q = (topic, question, expected_evidence, auditee, refs) => { const id = insert('audit_questions', { tenant_id: T, topic, question, expected_evidence, auditee });
      refs.map(r => ctl(ISO, r)).filter(Boolean).forEach(c => run('INSERT OR IGNORE INTO audit_question_controls VALUES (?,?)', id, c)); };
    q('Access management', 'Are user access rights reviewed at planned intervals and are the results acted on?', 'Last two access review records with sign-off', 'IT Operations Manager', ['A.5.18']);
    q('Access management', 'Is multi-factor authentication enforced for remote and administrator access?', 'Authentication policy configuration export', 'IT Operations Manager', ['A.8.5']);
    q('Human resources', 'Do all new joiners complete security awareness training before receiving system access?', 'Training records for the last five joiners', 'HR Manager', ['A.6.3']);
    q('Operations', 'Are backups tested by restoring data, and are the test results recorded?', 'Restore test reports for the last two quarters', 'IT Operations Manager', ['A.8.13']);
    q('Governance', 'Has top management approved the information security policy and is it reviewed at planned intervals?', 'Signed policy and review minutes', 'CISO', ['A.5.1']);
  });
  console.log('  First-run accounts created. Platform administrator: admin@cryptika.local — password: ' + DEMO_PASSWORD + (process.env.GRC_NO_DEMO === '1' ? '' : '  (demo organisation users use the same password; see README)'));
}
module.exports = { seedDemo, DEMO_PASSWORD };
