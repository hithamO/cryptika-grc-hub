'use strict';
// End-to-end API test. Starts its own server on a temporary data folder, so it never touches real data.
//   node tests/smoke.js
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const PORT = 4955; const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-test-'));
const srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT, GRC_DATA_DIR: dir }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
function client() {
  let cookie = '';
  const call = async (method, url, body, raw) => {
    const res = await fetch(BASE + url, { method, headers: { 'X-GRC-Client': '1', ...(cookie ? { Cookie: cookie } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: u => call('DELETE', u), upload: (u, buf) => call('POST', u, null, buf),
    login: async email => (await call('POST', '/auth/login', { email, password: 'Cryptika#2026' })).status };
}
(async () => {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/me'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  const [comp, writer, reviewer, ciso, risk, it, auditor, admin, platform] = [client(), client(), client(), client(), client(), client(), client(), client(), client()];
  console.log('Sign-in and permissions');
  ok(await comp.login('compliance@almanara.demo') === 200, 'compliance manager signs in');
  for (const [c, e] of [[writer, 'writer'], [reviewer, 'reviewer'], [ciso, 'ciso'], [risk, 'risk'], [it, 'it'], [auditor, 'auditor'], [admin, 'admin']]) await c.login(e + '@almanara.demo');
  await platform.login('admin@cryptika.local');
  ok((await client().get('/policies')).status === 401, 'anonymous request is refused');
  ok((await writer.get('/risk/risks')).status === 403, 'policy writer cannot open the risk register');
  ok((await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status) === 400, 'state-changing call without the client header is refused');

  console.log('Library (Phase 5 unified maps)');
  const lib = (await comp.get('/platform/library')).data.stats;
  ok(lib[0].rows === 22453 && lib[0].controls === 4632 && lib[0].links === 32921, 'Task 8 map: 22,453 rows / 4,632 controls / 32,921 links', lib[0]);
  ok(lib[1].rows === 3900 && lib[1].controls === 2432 && lib[1].links === 4784, 'Task 9 map: 3,900 rows / 2,432 controls / 4,784 links', lib[1]);
  const fws = (await comp.get('/frameworks')).data; ok(fws.length === 27, '27 frameworks available', fws.length);
  const iso = fws.find(f => f.code === 'ISO 27001:2022'); const cbj = fws.find(f => f.code === 'CBJ Non-Banking');

  console.log('Governance');
  const reg = (await comp.get('/governance/regulations')).data;
  ok(reg.adopted.some(a => a.code === 'CBJ Non-Banking' && a.requirement === 'mandatory'), 'insurer in Jordan gets CBJ Non-Banking as mandatory');
  ok((await comp.del('/governance/regulations/' + cbj.id)).status === 400, 'a mandatory framework cannot be removed');
  const nist = fws.find(f => f.code === 'NIST CSF 2.0');
  const before = (await comp.get('/compliance/overview')).data.frameworks;
  ok(before.find(f => f.id === iso.id).summary.doc.direct > 0, 'published policies give ISO 27001 documentation coverage');
  ok(before.find(f => f.id === nist.id).summary.doc.inherited_partial + before.find(f => f.id === nist.id).summary.doc.inherited > 0, 'a framework that is not adopted already shows inherited coverage');

  console.log('Policy life cycle through the approval chain');
  const a813 = (await writer.get(`/controls/search?q=A.8.15&framework_id=${iso.id}`)).data[0];
  const pol = (await writer.post('/policies', { title: 'Logging Policy', purpose: 'p', scope: 's', clauses: [{ text: 'Security events are logged and kept for one year.', control_ids: [a813.id] }] })).data;
  ok(!!pol.id, 'writer drafts a policy with a clause mapped to ISO A.8.15');
  ok((await comp.get('/controls/' + a813.id)).data.position.doc.state !== 'direct', 'a draft does not count towards compliance');
  ok((await writer.post(`/policies/${pol.id}/submit`)).status === 200, 'writer sends it for approval');
  ok((await writer.put(`/policies/${pol.id}`, { title: 'x' })).status === 403, 'author can no longer edit while it is with an approver');
  let p = (await reviewer.get('/policies/' + pol.id)).data;
  ok((await ciso.post(`/workflow/instances/${p.workflow.id}/act`, { action: 'approve' })).status === 403, 'CISO cannot approve out of turn');
  ok((await reviewer.put(`/policies/${pol.id}`, { summary: 'Reviewed' })).status === 200, 'current approver may edit');
  ok((await reviewer.post(`/workflow/instances/${p.workflow.id}/act`, { action: 'approve' })).status === 200, 'technical reviewer approves');
  ok((await comp.post(`/workflow/instances/${p.workflow.id}/act`, { action: 'reject' })).status === 400, 'rejecting without a comment is refused');
  await comp.post(`/workflow/instances/${p.workflow.id}/act`, { action: 'approve' });
  await ciso.post(`/workflow/instances/${p.workflow.id}/act`, { action: 'approve', comment: 'Approved' });
  p = (await writer.get('/policies/' + pol.id)).data;
  ok(p.status === 'published' && p.access.can_print && !p.access.can_edit, 'after the last approval the policy is published and locked');
  ok((await comp.get('/controls/' + a813.id)).data.position.doc.state === 'direct', 'the mapped control is now documented');
  ok((await writer.get('/notifications')).data.some(n => /Published/.test(n.title)), 'everyone is notified of the publication');

  console.log('Risk');
  ok((await risk.post('/risk/risks', { risk_type: 'cyber', title: 'No threat' })).status === 400, 'a cyber risk without threat + vulnerability is refused');
  const sug = (await risk.get('/risk/suggestions')).data; ok(sug.length > 0, 'mapped threat/vulnerability pairs are suggested as risks', sug.length);
  const nr = (await risk.post('/risk/risks', { risk_type: 'cyber', threat_id: sug[0].threat_id, vulnerability_id: sug[0].vulnerability_id })).data;
  ok(nr.workflow === 'in_progress', 'new risk waits for the Risk Manager');
  const inbox = (await risk.get('/workflow/inbox')).data; await risk.post(`/workflow/instances/${inbox[0].id}/act`, { action: 'approve' });
  ok((await risk.get('/risk/risks')).data.find(r => r.id === nr.id).status === 'registered', 'after confirmation it is registered');
  const ras = (await risk.get('/risk/assessments')).data; const ra = (await risk.get('/risk/assessments/' + ras[0].id)).data;
  ok(ra.items[0].inherent === 20 && ra.items[0].residual === 5, 'residual = 20 − (2 + 1) × 5 = 5', [ra.items[0].inherent, ra.items[0].residual]);
  ok(ra.items[2].inherent === 12 && ra.items[2].residual === 0, 'an avoided risk can reach 0', [ra.items[2].inherent, ra.items[2].residual]);
  const rc = ra.items[1].controls[0]; const s = (await risk.post(`/risk/item-controls/${rc.id}/suggest`)).data;
  ok(s.score >= 0 && s.score <= 5, 'effectiveness suggestion returned', s);
  ok((await risk.get('/risk/assessments/' + ra.id)).data.items[1].controls[0].effectiveness === 2, 'the analyst\'s own rating is kept over the suggestion');
  ok((await risk.post(`/risk/assessments/${ra.id}/complete`)).status === 400, 'assessment cannot be submitted while a risk is unscored');

  console.log('Gap assessment and evidence');
  const gaps = (await comp.get('/compliance/gap-assessments')).data; const gap = (await comp.get('/compliance/gap-assessments/' + gaps[0].id)).data;
  const reqs = (await it.get('/compliance/requests')).data; const mine = reqs.find(r => r.status === 'requested');
  ok(reqs.length > 0 && reqs.every(r => r.department === 'Information Technology'), 'IT sees only its own evidence requests', reqs.length);
  ok((await it.post(`/compliance/gap-items/${mine.id}/submit`, {})).status === 400, 'submitting without a file or note is refused');
  const up = await it.upload(`/evidence?entity_type=gap_item&entity_id=${mine.id}&filename=firewall-rules.png`, Buffer.from('fake image bytes'));
  ok(up.status === 200 && up.data.version === 1, 'evidence file uploaded');
  ok((await it.upload(`/evidence?entity_type=gap_item&entity_id=${mine.id}&filename=run.exe`, Buffer.from('x'))).status === 400, 'executable files are refused');
  await it.post(`/compliance/gap-items/${mine.id}/submit`, { response_note: 'Rules attached' });
  ok((await it.post(`/compliance/gap-items/${mine.id}/review`, { verdict: 'valid' })).status === 403, 'the department cannot validate its own evidence');
  const cov0 = (await comp.get('/compliance/frameworks/' + cbj.id)).data.summary.impl.direct;
  await comp.post(`/compliance/gap-items/${mine.id}/review`, { verdict: 'valid', note: 'OK' });
  ok((await comp.get('/compliance/frameworks/' + cbj.id)).data.summary.impl.direct === cov0 + 1, 'validated evidence raises implementation coverage');
  const dl = await fetch(`${BASE}/evidence/${up.data.id}/download`);
  ok(dl.status === 401, 'evidence cannot be downloaded without a session');

  console.log('Audit');
  const au = (await auditor.post('/audit/audits', { title: 'ISO 27001 internal audit', framework_id: iso.id, include_generated: true })).data;
  ok(au.from_pool >= 5 && au.generated > 100, 'programme built from the pool plus generated questions', au);
  const aud = (await auditor.get('/audit/audits/' + au.id)).data; const it0 = aud.items[0];
  const ans = (await auditor.put('/audit/items/' + it0.id, { answer: 'no', notes: 'No review performed' })).data;
  ok(!!ans.finding_ref, '"No" raises a finding automatically', ans.finding_ref);
  await auditor.put('/audit/items/' + it0.id, { answer: 'yes' });
  ok((await auditor.get('/audit/findings')).data.find(f => f.audit_item_id === it0.id).status === 'closed', 'changing the answer to "Yes" closes it');
  ok((await comp.get('/controls/' + it0.control_id)).data.position.impl.state === 'direct', 'an audit "Yes" counts as implementation evidence');

  console.log('Own framework and mapping');
  const own = (await comp.post('/frameworks', { code: 'AMI-STD', name: 'Al Manara internal standard' })).data;
  const imp = (await comp.post(`/frameworks/${own.id}/import`, { csv: 'Control ID,Title,Description,Family,Maps To\nAMI-1,Logging,Keep logs,Ops,ISO 27001:2022|A.8.15\nAMI-2,Other,Text,Ops,ISO 27001:2022|A.99' })).data;
  ok(imp.created === 2 && imp.links === 1 && imp.problems.length === 1, 'CSV import creates controls, one mapping and reports the bad one', imp);
  ok((await comp.get('/compliance/frameworks/' + own.id)).data.summary.doc.inherited === 1, 'own framework inherits through the tenant\'s own mapping');

  console.log('Tenant isolation');
  ok((await platform.post('/platform/tenants', { name: 'Second Org', admin_name: 'B Admin', admin_email: 'b@second.test', admin_password: 'AnotherPass#1' })).status === 200, 'platform admin creates a second organisation');
  const b = client(); await (async () => { const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GRC-Client': '1' }, body: JSON.stringify({ email: 'b@second.test', password: 'AnotherPass#1' }) }); b.cookie = r.headers.get('set-cookie').split(';')[0]; })();
  const bget = async u => { const r = await fetch(BASE + u, { headers: { Cookie: b.cookie } }); return { status: r.status, data: await r.json() }; };
  ok((await bget('/policies')).data.length === 0, 'second organisation sees none of the first one\'s policies');
  ok((await bget('/policies/' + pol.id)).status === 404, 'and cannot open one by id');
  ok((await bget('/frameworks')).data.every(f => f.code !== 'AMI-STD'), 'nor its own frameworks');
  ok((await bget('/controls/' + a813.id)).data.position.doc.state === 'gap', 'compliance position is computed per organisation');
  ok((await bget('/evidence/' + up.data.id + '/download')).status === 404, 'nor its evidence files');
  const bpost = async (u, body) => (await fetch(BASE + u, { method: 'POST', headers: { Cookie: b.cookie, 'Content-Type': 'application/json', 'X-GRC-Client': '1' }, body: JSON.stringify(body) })).status;
  ok(await bpost('/policies', { title: 'X', owner_id: 2 }) === 400, 'and cannot reference a person of another organisation');
  ok((await admin.get('/platform/tenants')).status === 403, 'a tenant administrator cannot reach the platform console');

  console.log('Organisation access');
  const second = (await platform.get('/platform/tenants')).data.find(o => o.name === 'Second Org');
  ok(second.access.status === 'active' && second.users === 1 && second.signed_in === 1, 'the console lists access state, people and open sessions', second);
  const relogin = async () => { const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GRC-Client': '1' }, body: JSON.stringify({ email: 'b@second.test', password: 'AnotherPass#1' }) }); const sc = r.headers.get('set-cookie'); if (sc) b.cookie = sc.split(';')[0]; return r.status; };
  ok((await platform.put('/platform/tenants/' + second.id, { status: 'read_only', until: new Date(Date.now() + 3600e3).toISOString(), reason: 'Renewal pending' })).status === 200, 'platform admin makes an organisation read-only for an hour');
  ok((await bget('/policies')).status === 200, 'a read-only organisation can still read');
  ok(await bpost('/governance/processes', { name: 'X' }) === 403, 'but cannot change anything');
  ok((await bget('/me')).data.tenant.access.reason === 'Renewal pending', 'and its people are told why');
  ok((await platform.put('/platform/tenants/' + second.id, { status: 'suspended', until: '2020-01-01T00:00:00Z' })).status === 400, 'an end date in the past is refused');
  await platform.put('/platform/tenants/' + second.id, { status: 'suspended', until: new Date(Date.now() + 1500).toISOString(), reason: 'Short pause' });
  ok((await bget('/policies')).status === 401, 'suspending signs everyone out at once');
  ok(await relogin() === 403, 'and sign-in is refused while suspended');
  await new Promise(r => setTimeout(r, 1800));
  ok(await relogin() === 200 && (await bget('/policies')).status === 200, 'access returns by itself when the time is up');
  await platform.put('/platform/tenants/' + second.id, { user_limit: 1 });
  const roleB = (await bget('/lookups')).data.roles[0].id;
  ok(await bpost('/admin/users', { name: 'Extra', email: 'extra@second.test', password: 'AnotherPass#2', role_id: roleB }) === 400, 'the people limit stops a further account');
  ok((await platform.post(`/platform/tenants/${second.id}/sign-out`)).data.ended === 1 && (await bget('/policies')).status === 401, 'platform admin can sign everyone out');

  console.log('Sharing');
  const via = async (email, password) => fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GRC-Client': '1', 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ email, password }) });
  ok((await via('admin@cryptika.local', 'Cryptika#2026')).status === 403, 'a first-run password is refused through a shared link');
  ok((await platform.post('/platform/admins', { name: 'The Boss', email: 'boss@cryptika.test', password: 'short' })).status === 400, 'platform team accounts need a real password');
  ok((await platform.post('/platform/admins', { name: 'The Boss', email: 'boss@cryptika.test', password: 'Own-Password#77' })).status === 200, 'a platform team account is created');
  const viaBoss = await via('boss@cryptika.test', 'Own-Password#77'); const bossCookie = viaBoss.headers.get('set-cookie') || '';
  ok(viaBoss.status === 200 && /;\s*Secure/.test(bossCookie), 'that account signs in through the link, with a secure cookie');
  ok((await fetch(BASE + '/platform/tenants', { headers: { Cookie: bossCookie.split(';')[0] } })).status === 200, 'and reaches every organisation');

  console.log('Company file import');
  const pkg = { organisation: { name: 'Imported Org', sector: 'Government', country: 'Saudi Arabia' }, frameworks: ['NCA ECC-2:2024'], categories: [{ name: 'Missing patches' }],
    assets: [{ key: 'a1', name: 'Server 1', asset_type: 'Server', criticality: 4 }], threats: [{ key: 't1', ref: 'T-01', name: 'Exploitation' }],
    vulnerabilities: [{ asset: 'a1', title: 'Outdated service', severity: 'High', category: 'Missing patches', threat: 't1' }],
    risks: [{ key: 'r1', ref: 'R-01', title: 'Exploitation of servers', threat: 't1' }],
    assessments: [{ name: 'Imported assessment', items: [{ risk: 'r1', likelihood: 3, impact: 4.5, treatment: 'mitigate', controls: [{ framework: 'NCA ECC', ref: '2-10-1' }], existing_control: { text: 'Existing controls', effectiveness: 1.3 }, expect: { inherent: 13.5, residual: 7 } }] }] };
  const done = await platform.post('/platform/import', pkg);
  ok(done.status === 200 && done.data.assets === 1 && done.data.vulnerabilities === 1 && done.data.risks === 1, 'a company file becomes an organisation', done.data);
  ok((await platform.post('/platform/import', pkg)).status === 400, 'the same company cannot be imported twice');
  await platform.post('/platform/switch', { tenant_id: done.data.tenant_id });
  const ira = (await platform.get('/risk/assessments')).data[0]; const item = (await platform.get('/risk/assessments/' + ira.id)).data.items[0];
  ok(item.inherent === 13.5 && item.residual === 7, 'scores match the source, including half steps', { inherent: item.inherent, residual: item.residual });
  ok((await platform.get('/risk/suggestions')).data.length === 0, 'a registered risk covers its threat, so nothing is suggested twice');
  ok((await platform.get('/risk/vuln-categories')).data.length === 1, 'the organisation keeps its own vulnerability categories');
  await platform.post('/platform/switch', { tenant_id: null });

  console.log(`\n${pass} passed, ${fail} failed`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
