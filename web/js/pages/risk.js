import { h, mount, clear, api, state, pageHead, btn, table, badge, modal, formModal, confirmBox, attempt, toast, can, opt, fmtDate, pickFile, controlChip, controlPicker, scoreTag, workflowPanel, download } from '../ui.js';
import { crudPage } from './_crud.js';

const edit = () => can('risk', 'edit');
const importResult = (title, lines) => modal({ title, body: h('div.stack.tight', null, lines.map(l => h('div', null, l))), actions: [{ label: 'Close', kind: 'primary', onclick: c => c() }] });

export const assets = root => crudPage(root, { title: 'Assets', subtitle: 'What the organisation depends on.',
  url: '/risk/assets', noun: 'asset', editable: edit(), empty: 'No assets yet', emptyHint: 'Add them, import a CSV inventory, or import a scan.',
  extraActions: [draw => btn('Export', () => download('/reports/export/assets')), draw => edit() ? btn('Import CSV', () => pickFile('.csv,text/csv', async text => { const r = await attempt(() => api.post('/risk/assets/import', { csv: text })); if (r) { importResult('Asset import finished', [`${r.created} assets created`, `${r.skipped} rows skipped (already registered or no name)`]); draw(); } })) : null],
  columns: [{ label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Asset', render: r => [h('b', null, r.name), h('div.muted.small', null, [r.asset_type, r.hostname, r.ip_address].filter(Boolean).join(' · '))] },
    { label: 'Owner', key: 'owner' }, { label: 'Custodian', key: 'custodian' }, { label: 'Department', key: 'department' }, { label: 'Criticality', render: r => `${r.criticality || '—'} / 5`, align: 'num' },
    { label: 'Open vulnerabilities', render: r => r.open_vulns ? badge(String(r.open_vulns), 'warn') : h('span.muted', null, '0'), align: 'right' }],
  fields: [{ name: 'name', label: 'Asset name', required: true }, { name: 'asset_type', label: 'Type', type: 'select', options: ['Application', 'Server', 'Database', 'Network device', 'Endpoint', 'Cloud service', 'Information', 'Facility', 'Host', 'Other'] },
    { name: 'hostname', label: 'Hostname' }, { name: 'ip_address', label: 'IP address' }, { name: 'owner', label: 'Owner' }, { name: 'custodian', label: 'Custodian' },
    { name: 'department_id', label: 'Department', type: 'select', options: opt(state.lookups.departments) }, { name: 'criticality', label: 'Criticality (1 low – 5 critical)', type: 'number', min: 1, max: 5 }, { name: 'description', label: 'Description', type: 'textarea' }] });

export const threats = root => crudPage(root, { title: 'Threats', subtitle: 'What could go wrong.',
  url: '/risk/threats', noun: 'threat', editable: edit(), empty: 'No threats registered yet', emptyHint: 'Start from the suggestions for your sector.',
  extraActions: [draw => edit() ? btn('Suggest threats', async () => {
    const d = await attempt(() => api.post('/risk/threats/discover')); if (!d) return; const chosen = new Set();
    modal({ title: 'Suggested threats', wide: true, body: h('div.stack', null, h('p.muted', null, `Suggested for ${[d.profile.sector, d.profile.country].filter(Boolean).join(', ') || 'your organisation'}. Tick the ones that apply.`),
      d.suggestions.length ? table({ rows: d.suggestions, columns: [{ label: '', render: s => h('input', { type: 'checkbox', onchange: e => e.target.checked ? chosen.add(s) : chosen.delete(s) }) },
        { label: 'Threat', render: s => [h('b', null, s.name), h('div.small.muted', null, s.description)] }, { label: 'Category', key: 'category' }, { label: 'Why suggested', render: s => [s.source === 'ai' ? badge('AI', 'plum') : null, h('span.small', null, ' ' + (s.rationale || ''))] }] })
        : h('div.empty', null, 'Nothing new to suggest.')),
      actions: [{ label: 'Cancel', onclick: c => c() }, { label: 'Register selected', kind: 'primary', onclick: async close => { if (!chosen.size) return toast('Tick at least one threat', 'bad'); if (await attempt(() => api.post('/risk/threats/bulk', { items: [...chosen] }), `${chosen.size} threat(s) registered`)) { close(); draw(); } } }] });
  }) : null],
  columns: [{ label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Threat', render: r => [h('b', null, r.name), h('div.muted.small', null, r.description || '')] }, { label: 'Category', key: 'category' },
    { label: 'Source', render: r => badge(r.source === 'ai' ? 'AI suggestion' : r.source === 'library' ? 'Threat library' : 'Added manually', r.source === 'ai' ? 'plum' : '') },
    { label: 'Mapped to', render: r => r.mappings ? `${r.mappings} mapping${r.mappings > 1 ? 's' : ''}` : h('a', { href: '#/risk/mapping' }, 'Not mapped') }],
  fields: [{ name: 'name', label: 'Threat', required: true, full: true }, { name: 'category', label: 'Category' }, { name: 'description', label: 'Description', type: 'textarea' }] });

export async function vulnerabilities(root) {
  const draw = async () => {
    const [rows, cats, assetList] = await Promise.all([api.get('/risk/vulnerabilities'), api.get('/risk/vuln-categories'), api.get('/risk/assets')]);
    let sev = '', cat = '', find = ''; const body = h('div'); const count = h('span.muted.small');
    const fields = [{ name: 'title', label: 'Vulnerability', required: true, full: true }, { name: 'asset_id', label: 'Asset', type: 'select', options: opt(assetList), required: true }, { name: 'severity', label: 'Severity', type: 'select', options: ['Critical', 'High', 'Medium', 'Low'], required: true },
      { name: 'category_id', label: 'Category', type: 'select', options: opt(cats), hint: 'Chosen from the title when left empty' }, { name: 'cve', label: 'CVE' }, { name: 'cvss', label: 'CVSS', type: 'number', min: 0, max: 10, step: 0.1 }, { name: 'port', label: 'Port' },
      { name: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'fixed', label: 'Fixed' }, { value: 'accepted', label: 'Accepted' }], required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'solution', label: 'Solution', type: 'textarea' }];
    const open = v => { if (!assetList.length) return toast('Register an asset first', 'bad');
      formModal({ title: v ? 'Edit vulnerability' : 'Add vulnerability', wide: true, fields, values: v || { status: 'open', severity: 'Medium' }, onSubmit: async d => { v ? await api.put('/risk/vulnerabilities/' + v.id, d) : await api.post('/risk/vulnerabilities', d); draw(); } }); };
    const drawT = () => { const shown = rows.filter(r => (!sev || r.severity === sev) && (!cat || String(r.category_id) === cat) && (!find || `${r.title} ${r.asset} ${r.cve || ''} ${r.ref}`.toLowerCase().includes(find)));
      count.textContent = shown.length === rows.length ? `${rows.length} recorded` : `${shown.length} of ${rows.length}`; mount(clear(body), table({ rows: shown, empty: 'No vulnerabilities recorded', emptyHint: 'Import a scan or add one.', columns: [
      { label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Vulnerability', render: r => [h('b', null, r.title), h('div.muted.small', null, [r.cve, r.port && `port ${r.port}`, r.source !== 'manual' && `from ${r.source}`].filter(Boolean).join(' · '))] },
      { label: 'Asset', width: '23%', render: r => [r.asset, h('div.muted.small', null, r.asset_ref)] }, { label: 'Severity', render: r => badge(r.severity) }, { label: 'CVSS', render: r => r.cvss ?? '—', align: 'num' }, { label: 'Category', width: '16%', render: r => h('span.small', null, r.category || '—') }, { label: 'Status', render: r => badge(r.status, r.status === 'open' ? 'warn' : 'ok') },
      { label: '', cls: 'actions', render: r => edit() ? [h('button.btn.link', { onclick: () => open(r) }, 'Edit'), h('button.btn.link', { onclick: async () => { if (await confirmBox('Delete this vulnerability?', 'Delete', 'danger') && await attempt(() => api.del('/risk/vulnerabilities/' + r.id))) draw(); } }, 'Delete')] : null }] })); };
    let timer; mount(clear(root), pageHead('Vulnerabilities', 'Weaknesses found on your assets.', [
      btn('Export', () => download('/reports/export/vulnerabilities')),
      edit() ? btn('Import scan results', () => pickFile('.csv,text/csv', async text => { const r = await attempt(() => api.post('/risk/vulnerabilities/import', { csv: text })); if (r) { importResult('Import finished', [`${r.imported} vulnerabilities imported`, `${r.assets_created} new assets registered from the scan`, `${r.duplicates} already recorded`, `${r.informational} informational rows ignored`]); draw(); } })) : null,
      edit() ? btn('Add vulnerability', () => open(null), 'primary') : null]),
      h('div.toolbar', null, h('input', { type: 'search', placeholder: 'Search by name, asset or CVE', style: 'width:290px', oninput: e => { clearTimeout(timer); timer = setTimeout(() => { find = e.target.value.trim().toLowerCase(); drawT(); }, 180); } }), h('select', { onchange: e => { sev = e.target.value; drawT(); } }, h('option', { value: '' }, 'All severities'), ['Critical', 'High', 'Medium', 'Low'].map(s => h('option', null, s))),
        h('select', { onchange: e => { cat = e.target.value; drawT(); } }, h('option', { value: '' }, 'All categories'), cats.map(c => h('option', { value: c.id }, c.name))), count), body);
    drawT();
  };
  await draw();
}

export async function mapping(root) {
  const draw = async () => {
    const [ths, cats, maps, vulns] = await Promise.all([api.get('/risk/threats'), api.get('/risk/vuln-categories'), api.get('/risk/threat-mappings'), api.get('/risk/vulnerabilities')]);
    const count = c => vulns.filter(v => v.category_id === c.id && v.status === 'open').length;
    const openVulns = vulns.filter(v => v.status === 'open'); const byId = new Map(vulns.map(v => [v.id, v]));
    const open = t => { const mine = maps.filter(m => m.threat_id === t.id); const catSel = new Set(mine.map(m => m.category_id).filter(Boolean)); const vSel = new Set(mine.map(m => m.vulnerability_id).filter(Boolean));
      const list = h('div.picker-list'); const picked = h('span.muted.small'); let q = '';
      const drawList = () => { const hits = openVulns.filter(v => !q || `${v.title} ${v.asset}`.toLowerCase().includes(q)).sort((a, b) => vSel.has(b.id) - vSel.has(a.id)); picked.textContent = `${vSel.size} selected`;
        mount(clear(list), hits.slice(0, 120).map(v => h('label.opt.check', null, h('input', { type: 'checkbox', checked: vSel.has(v.id), onchange: e => { e.target.checked ? vSel.add(v.id) : vSel.delete(v.id); picked.textContent = `${vSel.size} selected`; } }), h('span', null, `${v.title} — ${v.asset} `, badge(v.severity)))),
          hits.length > 120 ? h('div.opt.muted.small', null, `${hits.length - 120} more — search to narrow the list`) : null, hits.length ? null : h('div.empty', null, 'Nothing matches')); };
      modal({ title: `What can "${t.name}" exploit?`, wide: true, body: h('div.stack', null, h('h3', null, 'Vulnerability categories'), h('p.muted.small', null, 'Covers every open vulnerability in the category, now and later.'),
        h('div.grid.g2', null, cats.map(c => h('label.check', null, h('input', { type: 'checkbox', checked: catSel.has(c.id), onchange: e => e.target.checked ? catSel.add(c.id) : catSel.delete(c.id) }), h('span', null, c.name, ' ', h('span.muted.small', null, `(${count(c)} open)`))))),
        h('div.row.between', null, h('h3', null, 'Or single vulnerabilities'), picked),
        openVulns.length ? [h('input', { type: 'search', placeholder: 'Search vulnerabilities or assets', oninput: e => { q = e.target.value.trim().toLowerCase(); drawList(); } }), list] : h('span.muted', null, 'No open vulnerabilities recorded.')),
        actions: [{ label: 'Cancel', onclick: c => c() }, { label: 'Save mapping', kind: 'primary', onclick: async close => { if (await attempt(() => api.put(`/risk/threats/${t.id}/mappings`, { category_ids: [...catSel], vulnerability_ids: [...vSel] }), 'Mapping saved')) { close(); draw(); } } }] }); drawList(); };
    const exploits = t => { const mine = maps.filter(m => m.threat_id === t.id); if (!mine.length) return h('span.muted', null, 'Not mapped yet'); const single = mine.filter(m => m.vulnerability_id);
      return [mine.filter(m => m.category_id).map(m => h('span.chip', null, cats.find(c => c.id === m.category_id)?.name || 'Category')),
        single.length > 3 ? h('span.chip', null, `${single.length} vulnerabilities`) : single.map(m => h('span.chip', null, (byId.get(m.vulnerability_id)?.title || 'Vulnerability').slice(0, 50)))]; };
    mount(clear(root), pageHead('Threat mapping', 'Tie each threat to the weaknesses it can exploit.'),
      table({ rows: ths, empty: 'Register threats first', emptyHint: h('a', { href: '#/risk/threats' }, 'Go to threats'), columns: [{ label: 'Threat', render: t => [h('b', null, t.name), h('div.muted.small', null, t.category || '')] },
        { label: 'Can exploit', render: exploits },
        { label: '', cls: 'actions', render: t => edit() ? btn('Map', () => open(t), 'sm') : null }] }));
  };
  await draw();
}

export async function register(root) {
  const draw = async () => {
    const [risks, sugg] = await Promise.all([api.get('/risk/risks'), api.get('/risk/suggestions')]);
    const addBusiness = () => formModal({ title: 'Add business risk', wide: true, intro: 'A risk described in your own words.',
      fields: [{ name: 'title', label: 'Risk', required: true, full: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'category', label: 'Category', placeholder: 'e.g. Fraud, Operational, Financial' },
        { name: 'owner_id', label: 'Risk owner', type: 'select', options: opt(state.lookups.users) }, { name: 'department_id', label: 'Department', type: 'select', options: opt(state.lookups.departments) }],
      onSubmit: async d => { const r = await api.post('/risk/risks', { ...d, risk_type: 'business' }); toast(r.workflow === 'in_progress' ? 'Risk raised; waiting for confirmation' : 'Risk registered', 'ok'); draw(); } });
    const addCyber = async () => { const [ths, vulns] = await Promise.all([api.get('/risk/threats'), api.get('/risk/vulnerabilities')]);
      if (!ths.length || !vulns.length) return toast('Register a threat and a vulnerability first.', 'bad');
      formModal({ title: 'Add cyber risk', wide: true, intro: 'A threat exploiting a weakness on an asset.', fields: [{ name: 'threat_id', label: 'Threat', type: 'select', options: opt(ths), required: true },
        { name: 'vulnerability_id', label: 'Vulnerability (on asset)', type: 'select', options: vulns.map(v => ({ value: v.id, label: `${v.title} — ${v.asset}` })), required: true }, { name: 'title', label: 'Risk title', full: true, hint: 'Written for you when left empty' },
        { name: 'owner_id', label: 'Risk owner', type: 'select', options: opt(state.lookups.users) }, { name: 'department_id', label: 'Department', type: 'select', options: opt(state.lookups.departments) }],
        onSubmit: async d => { const r = await api.post('/risk/risks', { ...d, risk_type: 'cyber' }); toast(r.workflow === 'in_progress' ? 'Risk raised; waiting for confirmation' : 'Risk registered', 'ok'); draw(); } }); };
    const registerSugg = async s => { const r = await attempt(() => api.post('/risk/risks', { risk_type: 'cyber', threat_id: s.threat_id, vulnerability_id: s.vulnerability_id })); if (r) { toast(r.workflow === 'in_progress' ? 'Risk raised; waiting for confirmation' : 'Risk registered', 'ok'); draw(); } };
    mount(clear(root), pageHead('Risk register', 'Every identified risk, in one place.',
      edit() ? [btn('Add cyber risk', addCyber, 'primary'), btn('Add business risk', addBusiness), btn('Export', () => download('/reports/export/risks'))] : null, null,
      { stats: [{ v: risks.filter(r => r.status === 'registered').length, l: 'Registered' }, { v: risks.filter(r => r.status === 'pending').length, l: 'Awaiting confirmation' }, { v: sugg.length, l: 'Suggested' }] }),
      sugg.length ? h('div.card', { style: 'margin-bottom:18px' }, h('header', null, h('div', null, h('h3', null, `Suggested for registration (${sugg.length})`), h('div.muted.small', null, 'A threat meets an open weakness on one of your assets.'))),
        table({ rows: sugg.slice(0, 25), columns: [{ label: 'Threat', render: s => h('b', null, s.threat) }, { label: 'Vulnerability', key: 'vulnerability' }, { label: 'Asset', render: s => `${s.asset} (criticality ${s.criticality})` }, { label: 'Severity', render: s => badge(s.severity) },
          { label: '', cls: 'actions', render: s => edit() ? btn('Register as risk', () => registerSugg(s), 'sm') : null }] })) : null,
      table({ rows: risks, empty: 'The register is empty', emptyHint: 'Map threats to get suggestions, or add a risk.', columns: [
        { label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Risk', render: r => [h('b', null, r.title), h('div.muted.small', null, r.risk_type === 'cyber' ? [r.threat, r.asset].filter(Boolean).join(' → ') : (r.description || '').slice(0, 120))] },
        { label: 'Type', render: r => badge(r.risk_type === 'cyber' ? 'Cyber' : 'Business', r.risk_type === 'cyber' ? 'plum' : 'info') }, { label: 'Category', key: 'category' }, { label: 'Owner', key: 'owner_name' },
        { label: 'Last score', render: r => r.last_inherent ? scoreTag(r.last_inherent, r.last_inherent >= 17 ? 'Critical' : r.last_inherent >= 10 ? 'High' : r.last_inherent >= 5 ? 'Medium' : 'Low') : h('span.muted', null, 'Not assessed'), align: 'center' },
        { label: 'Status', render: r => badge(r.status === 'pending' ? 'Awaiting confirmation' : r.status, r.status === 'pending' ? 'warn' : undefined) },
        { label: '', cls: 'actions', render: r => can('risk', 'manage') && r.status === 'registered' ? h('button.btn.link', { onclick: async () => { if (await confirmBox('Close this risk? It stays in the register for the record.', 'Close risk') && await attempt(() => api.put('/risk/risks/' + r.id, { status: 'closed' }))) draw(); } }, 'Close') : null }] }));
  };
  await draw();
}

export async function assessments(root) {
  const rows = await api.get('/risk/assessments');
  const create = async () => { const risks = (await api.get('/risk/risks')).filter(r => r.status === 'registered'); if (!risks.length) return toast('The register has no confirmed risks to assess yet', 'bad');
    const chosen = new Set(risks.map(r => r.id)); const name = h('input', { type: 'text', placeholder: 'e.g. Annual cyber risk assessment 2026' }); const purpose = h('textarea', { rows: 2, placeholder: 'Why this assessment is being done' });
    const basis = h('input', { type: 'text', placeholder: 'Optional' });
    const appetite = h('input', { type: 'number', min: 1, max: 25, placeholder: 'Organisation default' });
    modal({ title: 'New risk assessment', wide: true, body: h('div.stack', null, h('div.form-grid', null, h('label.field.full', null, 'Name *', name), h('label.field.full', null, 'Purpose', purpose), h('label.field', null, 'Basis', basis),
      h('label.field', null, 'Risk appetite', appetite, h('span.hint', null, 'Scores up to this value are acceptable'))),
      h('h3', null, 'Risks to assess'),
      h('div.picker-list', null, risks.map(r => h('label.opt.check', null, h('input', { type: 'checkbox', checked: true, onchange: e => e.target.checked ? chosen.add(r.id) : chosen.delete(r.id) }), h('span', null, h('b', null, r.ref + ' '), r.title, ' ', badge(r.risk_type === 'cyber' ? 'Cyber' : 'Business', r.risk_type === 'cyber' ? 'plum' : 'info')))))),
      actions: [{ label: 'Cancel', onclick: c => c() }, { label: 'Start assessment', kind: 'primary', onclick: async close => { const r = await attempt(() => api.post('/risk/assessments', { name: name.value, purpose: purpose.value, basis: basis.value, appetite: Number(appetite.value) || undefined, risk_ids: [...chosen] })); if (r) { close(); location.hash = '#/risk/assessments/' + r.id; } } }] }); };
  mount(root, pageHead('Risk assessments', 'Score risks, choose a treatment and see what remains.', edit() ? btn('New risk assessment', create, 'primary') : null),
    table({ rows, empty: 'No risk assessment yet', onRow: r => location.hash = '#/risk/assessments/' + r.id, columns: [{ label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Assessment', render: r => [h('b', null, r.name), h('div.muted.small', null, r.purpose || '')] },
      { label: 'Risks', key: 'risks', align: 'right num' }, { label: 'Appetite', render: r => `≤ ${r.appetite}`, align: 'num' }, { label: 'Status', render: r => badge(r.status) }, { label: 'Started by', key: 'created_by_name' }, { label: 'Started', render: r => fmtDate(r.created_at) }] }));
}

const L_LABEL = ['', 'Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']; const I_LABEL = ['', 'Negligible', 'Minor', 'Moderate', 'Major', 'Severe'];
const TREAT = { accept: 'Accept', mitigate: 'Mitigate', transfer: 'Transfer', avoid: 'Avoid' };
const TREAT_HINT = { accept: 'Live with the risk as it is. No controls are applied.', mitigate: 'Reduce the impact with controls; the event can still happen.', transfer: 'Pass the consequences to a third party, such as an insurer or outsourcer.', avoid: 'Remove the possibility of the event; acts on likelihood and can bring the score to zero.' };
const lvl = s => s >= 17 ? 'Critical' : s >= 10 ? 'High' : s >= 5 ? 'Medium' : 'Low';
const cell = v => Math.min(5, Math.max(1, Math.ceil(v - 1e-9)));   // a score between two steps sits in the higher cell

export async function assessment(root, { id }) {
  const draw = async () => {
    const a = await api.get('/risk/assessments/' + id); const ed = a.editable;
    const save = async (item, patch) => { if (await attempt(() => api.put('/risk/assessment-items/' + item.id, patch))) draw(); };
    const scale = (item, key, labels) => h('select', { disabled: !ed, onchange: e => save(item, { [key]: Number(e.target.value) || null }) }, h('option', { value: '' }, '—'), [1, 2, 3, 4, 5].map(n => h('option', { value: n, selected: item[key] === n }, `${n} — ${labels[n]}`)),
      item[key] != null && !Number.isInteger(item[key]) ? h('option', { value: item[key], selected: true }, `${item[key]} — between ${labels[Math.floor(item[key])]} and ${labels[Math.ceil(item[key])]}`) : null);
    const matrix = key => { const grid = h('div.matrix'); for (let l = 5; l >= 1; l--) { mount(grid, h('div.ax', null, String(l))); for (let i = 1; i <= 5; i++) { const s = l * i;
      const n = key === 'inherent' ? a.items.filter(x => x.likelihood && x.impact && cell(x.likelihood) === l && cell(x.impact) === i).length : 0; mount(grid, h('div.cell', { style: `--i:${(5 - l) + i}`, class: `lv-${lvl(s)}${n ? '' : ' zero'}`, title: `Likelihood ${l} × impact ${i} = ${s}` }, n ? String(n) : '')); } }
      mount(grid, h('div.ax'), ...[1, 2, 3, 4, 5].map(i => h('div.ax', null, String(i)))); return grid; };
    const scored = a.items.filter(i => i.inherent != null); const above = scored.filter(i => i.residual > a.appetite).length;
    const riskCard = item => {
      const addControl = () => { if (item.risk_type === 'business') return formModal({ title: 'Describe the control', fields: [{ name: 'custom_control', label: 'Control', type: 'textarea', required: true }], onSubmit: async d => { await api.post(`/risk/assessment-items/${item.id}/controls`, d); draw(); } });
        modal({ title: 'Add a control', body: h('div.stack', null, btn('Choose from your frameworks', () => { document.querySelector('.overlay')?.remove(); controlPicker({ title: 'Controls that treat this risk', adoptedOnly: true, onDone: async cs => { for (const c of cs) await attempt(() => api.post(`/risk/assessment-items/${item.id}/controls`, { control_id: c.id })); draw(); } }); }, 'primary'),
          btn('Describe your own control', () => { document.querySelector('.overlay')?.remove(); formModal({ title: 'Describe the control', fields: [{ name: 'custom_control', label: 'Control', type: 'textarea', required: true }], onSubmit: async d => { await api.post(`/risk/assessment-items/${item.id}/controls`, d); draw(); } }); })), actions: [] }); };
      const sugBox = h('div');
      if (ed && item.risk_type === 'cyber' && item.treatment && item.treatment !== 'accept' && !item.controls.length) api.get(`/risk/assessment-items/${item.id}/control-suggestions`).then(s => { if (s.length) mount(sugBox, h('div.small', null, h('span.muted', null, 'Suggested: '),
        s.slice(0, 6).map(c => h('span.chip', { title: c.title }, h('span.fw', null, c.framework), c.ref, h('button', { onclick: async () => { if (await attempt(() => api.post(`/risk/assessment-items/${item.id}/controls`, { control_id: c.id }))) draw(); }, 'aria-label': 'Add' }, '+'))))); });
      return h('div.card', null, h('header', null, h('div', null, h('h3', null, `${item.risk_ref} — ${item.risk_title}`), h('div.muted.small', null, item.risk_type === 'cyber' ? [item.threat && `Threat: ${item.threat}`, item.vulnerability && `Vulnerability: ${item.vulnerability}`, item.asset && `Asset: ${item.asset}`].filter(Boolean).join(' · ') || (item.risk_description || '') : `Business risk${item.risk_description ? ' — ' + item.risk_description : ''}`)),
        h('div.row', null, h('div.center', null, h('div.muted.small', null, 'Inherent'), scoreTag(item.inherent, item.inherent_level)), h('span.muted', null, '→'), h('div.center', null, h('div.muted.small', null, 'Residual'), scoreTag(item.residual, item.residual_level)),
          item.within_appetite == null ? null : badge(item.within_appetite ? 'Within appetite' : 'Above appetite', item.within_appetite ? 'ok' : 'bad'))),
        h('div.body.stack', null, h('div.grid.g3', null, h('label.field', null, 'Likelihood', scale(item, 'likelihood', L_LABEL)), h('label.field', null, 'Impact', scale(item, 'impact', I_LABEL)),
          h('label.field', null, 'Treatment', h('select', { disabled: !ed, onchange: e => save(item, { treatment: e.target.value || null }) }, h('option', { value: '' }, '—'), Object.entries(TREAT).map(([k, v]) => h('option', { value: k, selected: item.treatment === k }, v))), item.treatment ? h('span.hint', null, TREAT_HINT[item.treatment]) : null)),
          item.treatment && item.treatment !== 'accept' ? h('div.stack.tight', null, h('div.row.between', null, h('h3', null, 'Controls and their effectiveness'), ed ? btn('Add control', addControl, 'sm') : null), sugBox,
            item.controls.length ? table({ rows: item.controls, columns: [
              { label: 'Control', render: c => c.control_id ? [controlChip({ id: c.control_id, ref: c.ref, framework: c.framework, title: c.title }), h('span.small', null, c.title || '')] : [badge('Own control', 'info'), ' ', c.custom_control] },
              { label: 'Suggestion', width: '250px', render: c => c.ai_suggestion != null ? h('div.small', null, h('b', null, `${c.ai_suggestion} / 5 `), h('span.muted', null, c.ai_rationale || '')) : ed ? btn('Suggest', async () => { if (await attempt(() => api.post(`/risk/item-controls/${c.id}/suggest`))) draw(); }, 'sm') : '—' },
              { label: 'Effectiveness (0–5)', width: '170px', render: c => h('div.row', null, h('input', { type: 'number', min: 0, max: 5, step: 0.5, value: c.effectiveness ?? '', disabled: !ed, style: 'width:76px', onchange: async e => { if (await attempt(() => api.put('/risk/item-controls/' + c.id, { effectiveness: e.target.value }))) draw(); } }),
                c.effectiveness_source ? badge(c.effectiveness_source === 'ai' ? 'Suggested' : 'Your rating', c.effectiveness_source === 'ai' ? 'plum' : 'ok') : null) },
              { label: 'Reduces score by', align: 'right num', render: c => c.effectiveness != null ? `− ${c.effectiveness * 5}` : '—' },
              { label: '', cls: 'actions', render: c => ed ? h('button.btn.link', { onclick: async () => { if (await attempt(() => api.del('/risk/item-controls/' + c.id))) draw(); } }, 'Remove') : null }] })
              : h('div.muted.small', null, 'Add a control to reduce the score.'),
            item.inherent != null && item.controls.length ? h('div.small.muted', null, `Residual = ${item.inherent} − ${item.reduction} = ${item.residual}${item.inherent - item.reduction < item.residual ? ` (never below ${item.treatment === 'avoid' ? 0 : 1})` : ''}`) : null) : null,
          h('div.form-grid', null, h('label.field.full', null, 'Treatment plan', h('textarea', { rows: 2, disabled: !ed, onchange: e => save(item, { treatment_plan: e.target.value }) }, item.treatment_plan || '')),
            h('label.field', null, 'Action owner', h('input', { type: 'text', value: item.treatment_owner || '', disabled: !ed, onchange: e => save(item, { treatment_owner: e.target.value }) })),
            h('label.field', null, 'Due date', h('input', { type: 'date', value: item.due_date || '', disabled: !ed, onchange: e => save(item, { due_date: e.target.value }) })))));
    };
    mount(clear(root), pageHead(a.name, [a.purpose, a.basis && `Basis: ${a.basis}`].filter(Boolean).join(' — '), [ed ? btn('Submit for sign-off', async () => { if (await attempt(() => api.post(`/risk/assessments/${id}/complete`), 'Submitted for sign-off')) draw(); }, 'primary') : null, btn('Print', () => window.print())], [h('a', { href: '#/risk/assessments' }, 'Assessments'), ` / ${a.ref}`], { stats: [{ v: scored.length, unit: ` / ${a.items.length}`, l: 'Scored' }, { v: above, l: 'Above appetite' }, { v: `≤ ${a.appetite}`, l: 'Appetite' }] }),
      h('div.grid', { style: 'grid-template-columns: 320px 1fr; margin:8px 0 22px; align-items:start' }, h('div.card.pad.stack', null, h('div.label', null, 'Inherent risk'), matrix('inherent'), h('div.muted.small.center', null, 'Likelihood ↑   Impact →')),
        h('div.card.pad.stack', null, h('div.row.between', null, h('div.label', null, 'Before and after treatment'), badge(a.status)),
          table({ rows: scored, empty: 'Score the risks below to see the result', columns: [{ label: 'Risk', render: i => [h('span.ref', null, i.risk_ref), ' ', i.risk_title] }, { label: 'Inherent', render: i => scoreTag(i.inherent, i.inherent_level), align: 'center' }, { label: 'Treatment', render: i => TREAT[i.treatment] || '—' },
            { label: 'Residual', render: i => scoreTag(i.residual, i.residual_level), align: 'center' }, { label: '', render: i => i.within_appetite == null ? '' : badge(i.within_appetite ? 'Acceptable' : 'Needs more treatment', i.within_appetite ? 'ok' : 'bad') }] }))),
      h('div.no-print', { style: 'margin-bottom:18px' }, workflowPanel(a.workflow, draw)), h('div.stack', null, a.items.map(riskCard)));
  };
  await draw();
}
