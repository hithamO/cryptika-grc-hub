import { h, mount, clear, api, state, pageHead, sectionHead, cleanText, btn, table, badge, modal, formModal, confirmBox, attempt, toast, can, opt, fmtDate, covBar, covLegend, stateTag, evidencePanel, download } from '../ui.js';
import { ring } from '../charts.js';

const GREEN = '#0f9f6e', PLUM = '#6a35a0';
const fwRing = (s, size = 92) => ring({ rings: [{ pct: s.doc.pct, color: GREEN }, { pct: s.impl.pct, color: PLUM }], size, stroke: size > 100 ? 12 : 8, gap: size > 100 ? 6 : 4, mid: h('b', null, `${Math.round(s.overall_pct)}%`) });
const ringLegend = () => h('div.legend', null, h('span.direct', null, 'Documentation'), h('span.inherited', null, 'Implementation'));

export async function overview(root) {
  const d = await api.get('/compliance/overview'); const inScope = d.frameworks.filter(f => f.adopted); const others = d.frameworks.filter(f => !f.adopted && f.summary.applicable);
  const avg = inScope.length ? Math.round(inScope.reduce((s, f) => s + f.summary.overall_pct, 0) / inScope.length * 10) / 10 : 0;
  pageHead('Compliance position', 'Where you stand on every framework, from your policies, evidence and audits.', can('compliance', 'edit') ? btn('Start a gap assessment', () => newGap(), 'primary') : null, null,
    { stats: [{ v: avg, unit: '%', l: 'Average across your scope' }, { v: inScope.length, l: 'Frameworks in scope' }, { v: inScope.reduce((s, f) => s + f.summary.doc.gap, 0).toLocaleString(), l: 'Controls without a policy' }] });
  const rest = h('div');
  mount(root, sectionHead('In scope', null, ringLegend()),
    inScope.length ? h('div.grid.g3', null, inScope.map((f, i) => h('div.card.lift.fw-card.rise', { style: `animation-delay:${i * 0.05}s`, onclick: () => location.hash = '#/compliance/frameworks/' + f.id }, fwRing(f.summary),
      h('div.grow', null, h('div.label', null, f.requirement === 'mandatory' ? 'Mandatory' : 'Voluntary'), h('h3', { style: 'margin:6px 0 4px' }, f.code),
        h('div.muted.small', null, `${f.summary.doc.pct}% documented · ${f.summary.impl.pct}% implemented`)))))
      : h('div.card', null, h('div.empty', null, h('b', null, 'No framework in scope yet'), h('a', { href: '#/governance/regulations' }, 'Choose the laws and standards you follow'))),
    sectionHead('Not in scope yet', 'Your starting position if you adopt them.', covLegend()), rest);
  const sorted = others.sort((a, b) => b.summary.overall_pct - a.summary.overall_pct);
  const drawRest = all => mount(clear(rest), table({ rows: all ? sorted : sorted.slice(0, 5), empty: 'Every framework is in scope', onRow: f => location.hash = '#/compliance/frameworks/' + f.id, columns: [
      { label: 'Framework', render: f => [h('b', null, f.code), h('div.muted.small', null, f.region)] }, { label: 'Controls', render: f => f.summary.applicable, align: 'right num' },
      { label: 'Documentation', render: f => h('div.row', null, h('div.grow', null, covBar(f.summary.doc, f.summary.applicable)), h('span.num', { style: 'width:46px;text-align:right' }, f.summary.doc.pct + '%')), width: '24%' },
      { label: 'Implementation', render: f => h('div.row', null, h('div.grow', null, covBar(f.summary.impl, f.summary.applicable)), h('span.num', { style: 'width:46px;text-align:right' }, f.summary.impl.pct + '%')), width: '24%' },
      { label: 'Overall', render: f => h('b.num', null, f.summary.overall_pct + '%'), align: 'right' }] }),
    !all && sorted.length > 5 ? h('div.center', { style: 'margin-top:14px' }, btn(`Show all ${sorted.length} frameworks`, () => drawRest(true))) : null);
  drawRest(false);
}

export async function framework(root, { id }) {
  const d = await api.get('/compliance/frameworks/' + id); const f = d.framework; const s = d.summary; let filter = 'all', q = '';
  const body = h('div');
  const match = c => (filter === 'all' || (filter === 'gap' && !c.na && (c.doc.state === 'gap' || c.impl.state === 'gap')) || (filter === 'inherited' && !c.na && (c.doc.state.startsWith('inherited') || c.impl.state.startsWith('inherited'))) || (filter === 'direct' && (c.doc.state === 'direct' || c.impl.state === 'direct')))
    && (!q || `${c.ref} ${c.title || ''}`.toLowerCase().includes(q));
  const draw = () => { const rows = d.controls.filter(match); mount(clear(body), table({ rows: rows.slice(0, 400), empty: 'No control matches this filter', onRow: c => location.hash = '#/controls/' + c.id, columns: [
    { label: 'Control', width: '130px', render: c => h('span.ref', null, c.ref) }, { label: 'Requirement', render: c => c.title || h('span.muted', null, '—') },
    { label: 'Documentation', width: '170px', render: c => c.na ? h('span.muted', null, 'Not applicable') : stateTag(c.doc.state) }, { label: 'Implementation', width: '170px', render: c => c.na ? '' : stateTag(c.impl.state) }] }),
    rows.length > 400 ? h('p.muted.small', null, `Showing the first 400 of ${rows.length}. Narrow the filter to see the rest.`) : null); };
  const block = (label, dim, hint) => h('div.card.pad.stack.tight', null, h('div.row.between', null, h('div.label', null, label), h('span.pct', { style: 'font-size:28px' }, dim.pct + '%')), covBar(dim, s.applicable, true),
    h('div.small.muted', null, `${hint} · ${dim.direct} own · ${dim.inherited + dim.inherited_partial} inherited · ${dim.gap} gap`));
  pageHead(f.code, f.name, [can('compliance', 'edit') ? btn('Start gap assessment', () => newGap(Number(id)), 'primary') : null, btn('Export', () => download('/reports/export/compliance?framework_id=' + id)), btn('View controls', () => location.hash = '#/frameworks/' + id)],
    h('a', { href: '#/compliance' }, 'Position'), { stats: [{ v: s.overall_pct, unit: '%', l: f.adopted ? 'Overall' : 'Overall · not in scope' }, { v: s.doc.pct, unit: '%', l: 'Documentation' }, { v: s.impl.pct, unit: '%', l: 'Implementation' }] });
  mount(root, h('div.grid.g2', { style: 'margin:8px 0 22px' }, block('Documentation', s.doc, 'From your published policies'), block('Implementation', s.impl, 'From validated evidence and audits')),
    h('div.toolbar', null, h('select', { onchange: e => { filter = e.target.value; draw(); } }, [['all', 'All controls'], ['gap', 'With a gap'], ['inherited', 'Inherited through the map'], ['direct', 'With own evidence']].map(([v, l]) => h('option', { value: v }, l))),
      h('input', { type: 'search', placeholder: 'Search control', oninput: e => { q = e.target.value.toLowerCase(); draw(); } }), h('span.grow'), covLegend()), body);
  draw();
}

function newGap(frameworkId) {
  formModal({ title: 'New gap assessment', intro: 'Requests evidence for the controls of one framework.',
    fields: [{ name: 'framework_id', label: 'Framework', type: 'select', required: true, options: state.lookups.frameworks.filter(f => f.adopted || f.id === frameworkId).map(f => ({ value: f.id, label: f.code })) },
      { name: 'due_date', label: 'Evidence due by', type: 'date' }, { name: 'name', label: 'Name', full: true, placeholder: 'Optional' },
      { name: 'include_satisfied', label: 'Include controls that already have valid evidence', type: 'checkbox', full: true }], values: { framework_id: frameworkId },
    onSubmit: async d => { const r = await api.post('/compliance/gap-assessments', d); toast(`${r.items} controls added to the assessment`, 'ok'); location.hash = '#/compliance/gaps/' + r.id; } });
}

export async function gaps(root) {
  const rows = await api.get('/compliance/gap-assessments');
  mount(root, pageHead('Gap assessments', 'Collect implementation evidence from each department, control by control.',
    can('compliance', 'edit') ? btn('New gap assessment', () => newGap(), 'primary') : null),
    table({ rows, empty: 'No gap assessment yet', onRow: r => location.hash = '#/compliance/gaps/' + r.id, columns: [{ label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Assessment', render: r => [h('b', null, r.name), h('div.muted.small', null, r.framework)] },
      { label: 'Status', render: r => badge(r.status) }, { label: 'Controls', key: 'items', align: 'right num' }, { label: 'Valid', key: 'valid', align: 'right num' }, { label: 'To review', render: r => r.submitted ? badge(String(r.submitted), 'plum') : '0', align: 'right' },
      { label: 'With departments', key: 'waiting', align: 'right num' }, { label: 'Not assigned', key: 'unassigned', align: 'right num' }, { label: 'Due', render: r => fmtDate(r.due_date) }] }));
}

export async function gap(root, { id }) {
  let status = '', dept = ''; const selected = new Set();
  const draw = async () => {
    const a = await api.get('/compliance/gap-assessments/' + id); const manage = a.can_manage; const depts = state.lookups.departments;
    const count = st => a.items.filter(i => i.status === st).length; const act = async (fn, msg) => { if (await attempt(fn, msg)) { selected.clear(); draw(); } };
    const review = i => { const note = h('textarea', { rows: 2, placeholder: 'Note to the department (required when returning)' });
      const decide = async (verdict, close) => { if (await attempt(() => api.post(`/compliance/gap-items/${i.id}/review`, { verdict, note: note.value }), verdict === 'valid' ? 'Evidence accepted' : 'Returned to the department')) { close(); draw(); } };
      modal({ title: `${a.framework} ${i.ref} — review evidence`, wide: true, body: h('div.stack', null, h('div', null, h('b', null, i.title || ''), h('div.small.pre', null, cleanText(i.description))),
        h('div.note', null, h('b', null, 'Evidence asked for: '), i.evidence_guidance || '—'),
        h('div', null, h('h3', null, 'Submitted'), h('div.small.muted', null, i.submitted_by_name ? `${i.submitted_by_name}, ${fmtDate(i.submitted_at)}` : 'Nothing submitted yet'), i.response_note ? h('p.pre', null, i.response_note) : null), evidencePanel('gap_item', i.id, false),
        i.reviewer_note ? h('div.small.muted', null, `Previous decision: ${i.reviewer_note}`) : null, i.status === 'submitted' || i.status === 'valid' || i.status === 'invalid' ? note : null),
        actions: ['submitted', 'valid', 'invalid'].includes(i.status) && manage ? [{ label: 'Close', onclick: c => c() }, { label: 'Return as invalid', kind: 'danger', onclick: c => decide('invalid', c) }, { label: 'Accept as valid', kind: 'ok', onclick: c => decide('valid', c) }] : [{ label: 'Close', onclick: c => c() }] }); };
    const rows = a.items.filter(i => (!status || i.status === status) && (!dept || String(i.department_id || '') === dept));
    mount(clear(root), pageHead(a.name, a.due_date ? `${a.framework} · evidence due ${fmtDate(a.due_date)}` : a.framework, manage ? [
      count('unassigned') && a.items.some(i => i.status === 'unassigned' && !i.department_id) ? btn('Accept suggested departments', () => act(() => api.post(`/compliance/gap-assessments/${id}/assign`, { accept_suggestions: true }), 'Suggested departments applied')) : null,
      a.items.some(i => i.status === 'unassigned' && i.department_id) ? btn('Send evidence requests', () => act(() => api.post(`/compliance/gap-assessments/${id}/send`), 'Requests sent to the departments'), 'primary') : null,
      a.status === 'in_progress' ? btn('Close assessment', async () => { if (await confirmBox('Close this assessment? Departments can no longer submit evidence to it.', 'Close assessment')) act(() => api.post(`/compliance/gap-assessments/${id}/complete`), 'Assessment closed'); }) : null] : null,
      [h('a', { href: '#/compliance/gaps' }, 'Gap assessments'), ` / ${a.ref}`], { stats: [{ v: count('valid'), unit: ` / ${a.items.length}`, l: 'Valid' }, { v: count('submitted'), l: 'To review' }, { v: count('requested') + count('invalid'), l: 'With departments' }] }),
      a.status === 'draft' ? h('div.note', { style: 'margin-bottom:14px' }, 'Assign each control to a department, then send the requests.') : null,
      h('div.toolbar', null, h('select', { onchange: e => { status = e.target.value; draw(); } }, h('option', { value: '' }, 'All statuses'), ['unassigned', 'requested', 'submitted', 'valid', 'invalid', 'not_applicable'].map(s => h('option', { value: s, selected: s === status }, badge(s).textContent))),
        h('select', { onchange: e => { dept = e.target.value; draw(); } }, h('option', { value: '' }, 'All departments'), depts.map(d => h('option', { value: d.id, selected: String(d.id) === dept }, d.name))),
        manage ? [h('span.grow'), h('span.muted.small', null, 'Assign ticked controls to'), h('select', { onchange: e => { if (e.target.value && selected.size) act(() => api.post(`/compliance/gap-assessments/${id}/assign`, { department_id: Number(e.target.value), item_ids: [...selected] }), 'Assigned'); else if (e.target.value) { toast('Tick the controls first', 'bad'); e.target.value = ''; } } }, h('option', { value: '' }, 'Department…'), depts.map(d => h('option', { value: d.id }, d.name)))] : null),
      table({ rows, empty: 'No control matches this filter', columns: [
        manage ? { label: '', width: '30px', render: i => ['unassigned', 'requested', 'invalid'].includes(i.status) ? h('input', { type: 'checkbox', checked: selected.has(i.id), onchange: e => e.target.checked ? selected.add(i.id) : selected.delete(i.id) }) : null } : null,
        { label: 'Control', width: '110px', render: i => h('a.ref', { href: '#/controls/' + i.control_id }, i.ref) }, { label: 'Requirement and evidence asked for', render: i => [h('b', null, i.title || cleanText(i.description).slice(0, 110)), h('div.small.muted', null, i.evidence_guidance)] },
        { label: 'Department', width: '170px', render: i => i.department ? i.department : i.suggested_department ? h('span.muted.small', null, `Suggested: ${i.suggested_department}`) : '—' },
        { label: 'Status', width: '150px', render: i => [badge(i.status), i.files ? h('div.muted.small', null, `${i.files} file(s)`) : null] },
        { label: '', cls: 'actions', render: i => [i.status === 'submitted' && manage ? btn('Review', () => review(i), 'sm primary') : ['valid', 'invalid', 'requested'].includes(i.status) ? h('button.btn.link', { onclick: () => review(i) }, 'Open') : null,
          manage && ['unassigned', 'requested'].includes(i.status) ? h('button.btn.link', { onclick: () => act(() => api.put('/compliance/gap-items/' + i.id, { status: 'not_applicable' })) }, 'N/A') : null,
          manage && i.status === 'not_applicable' ? h('button.btn.link', { onclick: () => act(() => api.put('/compliance/gap-items/' + i.id, { status: 'unassigned' })) }, 'Restore') : null] }].filter(Boolean) }));
  };
  await draw();
}

export async function requests(root) {
  const draw = async () => {
    const rows = await api.get('/compliance/requests'); const deptName = state.lookups.departments.find(d => d.id === state.me.user.department_id)?.name;
    mount(clear(root), pageHead('Evidence requests', deptName ? `What the compliance team needs from ${deptName}.` : 'Join a department to receive evidence requests.'),
      rows.length ? h('div.stack', null, rows.map(i => { const note = h('textarea', { rows: 2, placeholder: 'Describe what you attached, or explain how the control is met' }, i.response_note || ''); const open = i.status !== 'submitted';
        return h('div.card', null, h('header', null, h('div', null, h('h3', null, `${i.assessment.framework} ${i.ref}${i.title ? ' — ' + i.title : ''}`), h('div.muted.small', null, `${i.assessment.ref} ${i.assessment.name}${i.assessment.due_date ? ' · due ' + fmtDate(i.assessment.due_date) : ''}`)), badge(i.status)),
          h('div.body.stack', null, i.description ? h('div.small.pre', null, cleanText(i.description).slice(0, 600)) : null, h('div.note', null, h('b', null, 'Evidence asked for: '), i.evidence_guidance || 'Anything that shows the control working.'),
            i.status === 'invalid' ? h('div.note.bad', null, h('b', null, 'Returned by compliance: '), i.reviewer_note || '') : null, evidencePanel('gap_item', i.id, open),
            open ? [note, h('div', null, btn('Submit evidence', async () => { if (await attempt(() => api.post(`/compliance/gap-items/${i.id}/submit`, { response_note: note.value }), 'Submitted to compliance for review')) draw(); }, 'primary'))] : h('div.small.muted', null, `Submitted ${fmtDate(i.submitted_at)} — waiting for the compliance decision. ${i.response_note || ''}`))); }))
        : h('div.card', null, h('div.empty', null, h('b', null, 'No open evidence requests'), 'You will be notified when evidence is needed.')));
  };
  await draw();
}
