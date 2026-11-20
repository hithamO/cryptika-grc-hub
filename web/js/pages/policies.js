import { h, mount, clear, api, state, pageHead, btn, table, badge, buildForm, confirmBox, attempt, toast, can, opt, fmtDate, controlChip, controlPicker, workflowPanel } from '../ui.js';

const TYPES = ['Policy', 'Standard', 'Procedure', 'SOP', 'Guideline'];

export async function list(root) {
  const rows = await api.get('/policies'); const edit = can('policies', 'edit');
  let status = '';
  const body = h('div');
  const draw = () => mount(clear(body), table({ rows: rows.filter(p => status ? p.status === status : p.status !== 'retired'), empty: 'No policy yet', emptyHint: 'Write the first one.',
    onRow: p => location.hash = '#/policies/' + p.id, columns: [
      { label: 'Reference', render: p => h('span.ref', null, p.ref) }, { label: 'Title', render: p => [h('b', null, p.title), h('div.muted.small', null, [p.doc_type, p.category].filter(Boolean).join(' · '))] },
      { label: 'Version', key: 'version', align: 'num' }, { label: 'Status', render: p => [badge(p.status), p.stage ? h('div.muted.small', null, `At: ${p.stage}`) : null] },
      { label: 'Clauses', key: 'clauses', align: 'right num' }, { label: 'Controls covered', key: 'mapped_controls', align: 'right num' }, { label: 'Owner', key: 'owner_name' }, { label: 'Review due', render: p => fmtDate(p.review_date) }] }));
  const sel = h('select', { onchange: e => { status = e.target.value; draw(); } }, h('option', { value: '' }, 'All current'), ['draft', 'in_review', 'published', 'rejected', 'retired'].map(s => h('option', { value: s }, s === 'in_review' ? 'In review' : s === 'rejected' ? 'Returned' : s[0].toUpperCase() + s.slice(1))));
  const n = st => rows.filter(p => st.includes(p.status)).length;
  mount(root, pageHead('Policies', 'Write, approve and publish. Every clause names the control it satisfies.',
    edit ? [can('policies', 'manage') ? btn('Add an existing policy', () => location.hash = '#/policies/new?imported') : null, btn('Write a policy', () => location.hash = '#/policies/new', 'primary')].reverse() : null, null,
    { stats: [{ v: n(['published']), l: 'In force' }, { v: n(['in_review']), l: 'In review' }, { v: n(['draft', 'rejected']), l: 'Drafts' }] }),
    h('div.toolbar', null, sel), body);
  draw();
}

export async function view(root, { id }) {
  const draw = async () => {
    const p = await api.get('/policies/' + id); const a = p.access;
    const act = async (fn, msg) => { if (await attempt(fn, msg)) draw(); };
    mount(clear(root), pageHead(p.title, null, [
      a.can_edit ? btn('Edit', () => location.hash = `#/policies/${id}/edit`) : null,
      a.can_submit ? btn('Send for approval', () => act(() => api.post(`/policies/${id}/submit`), 'Sent for approval'), 'primary') : null,
      a.can_revise ? btn('Start new version', async () => { const r = await attempt(() => api.post(`/policies/${id}/revise`)); if (r) location.hash = `#/policies/${r.id}/edit`; }) : null,
      a.can_print ? btn('Print', () => window.print(), 'primary') : null,
      a.can_delete ? btn('Delete draft', async () => { if (await confirmBox('Delete this draft?', 'Delete', 'danger') && await attempt(() => api.del('/policies/' + id))) location.hash = '#/policies'; }, 'danger') : null],
      h('a', { href: '#/policies' }, 'Policies')),
      p.status === 'rejected' ? h('div.note.bad.no-print', { style: 'margin-bottom:14px' }, 'Returned by an approver. Revise it and send it again.') : null,
      p.status !== 'published' ? h('div.note.no-print', { style: 'margin-bottom:14px' }, 'Not in force yet.') : null,
      h('div.stack.loose', null, h('div.no-print', null, workflowPanel(p.workflow, draw)),
        h('div.doc', null,
          h('div.muted.small', null, state.me.tenant.name), h('h1', null, p.title),
          h('table', null, h('tbody', null,
            h('tr', null, h('th', null, 'Reference'), h('td', null, p.ref), h('th', null, 'Version'), h('td', null, p.version)),
            h('tr', null, h('th', null, 'Document type'), h('td', null, p.doc_type), h('th', null, 'Status'), h('td', null, badge(p.status))),
            h('tr', null, h('th', null, 'Owner'), h('td', null, p.owner_name || '—'), h('th', null, 'Published'), h('td', null, fmtDate(p.published_at))),
            h('tr', null, h('th', null, 'Category'), h('td', null, p.category || '—'), h('th', null, 'Next review'), h('td', null, fmtDate(p.review_date))),
            h('tr', null, h('th', null, 'Compliance driver'), h('td', { colspan: 3 }, p.driver_framework || '—', p.driver_controls.length ? [' — ', p.driver_controls.map(c => controlChip(c))] : null)))),
          p.purpose ? [h('h2', null, 'Purpose'), h('p.pre', null, p.purpose)] : null, p.scope ? [h('h2', null, 'Scope'), h('p.pre', null, p.scope)] : null,
          h('h2', null, 'Policy statements'),
          p.clauses.length ? h('table', null, h('thead', null, h('tr', null, h('th', { style: 'width:44px' }, 'No.'), h('th', null, 'Statement'), h('th', { style: 'width:30%' }, 'Satisfies'))),
            h('tbody', null, p.clauses.map(c => h('tr', null, h('td', null, c.number), h('td.pre', null, c.text), h('td', null, c.controls.length ? c.controls.map(x => controlChip(x)) : h('span.muted', null, '—'))))))
            : h('p.muted', null, 'No clause written yet.'),
          p.summary ? [h('h2', null, 'Summary'), h('p.pre', null, p.summary)] : null,
          h('p.muted.small', { style: 'margin-top:26px' }, `Prepared by ${p.author_name || '—'} · ${fmtDate(new Date().toISOString())}`))));
  };
  await draw();
}

export async function edit(root, { id }) {
  const imported = !id && location.hash.includes('imported');
  const p = id ? await api.get('/policies/' + id) : { clauses: [], driver_controls: [], doc_type: 'Policy', version: '1.0' };
  if (id && !p.access.can_edit) { location.hash = '#/policies/' + id; return; }
  const form = buildForm([
    { name: 'title', label: 'Title', required: true, full: true }, { name: 'doc_type', label: 'Document type', type: 'select', options: TYPES, required: true }, { name: 'category', label: 'Category', placeholder: 'e.g. Access management' },
    { name: 'version', label: 'Version' }, { name: 'owner_id', label: 'Owner', type: 'select', options: opt(state.lookups.users) },
    { name: 'driver_framework_id', label: 'Compliance driver', type: 'select', options: state.lookups.frameworks.filter(f => f.adopted).map(f => ({ value: f.id, label: f.code })), hint: 'The framework this policy answers to' },
    { name: 'review_date', label: 'Next review', type: 'date' },
    { name: 'purpose', label: 'Purpose', type: 'textarea' }, { name: 'scope', label: 'Scope', type: 'textarea' }, { name: 'summary', label: 'Summary', type: 'textarea', rows: 2 }], p);
  let drivers = [...p.driver_controls]; const clauses = p.clauses.map(c => ({ number: c.number, text: c.text, controls: [...c.controls] }));
  const driverBox = h('div'); const clauseBox = h('div.stack');
  const fwId = () => Number(form.inputs.driver_framework_id.value) || undefined;
  const drawDrivers = () => mount(clear(driverBox), drivers.map(c => controlChip(c, () => { drivers = drivers.filter(x => x.id !== c.id); drawDrivers(); })),
    btn('Add controls', () => controlPicker({ title: 'Controls this policy as a whole addresses', frameworkId: fwId(), onDone: cs => { cs.forEach(c => { if (!drivers.some(x => x.id === c.id)) drivers.push(c); }); drawDrivers(); } }), 'sm'));
  const drawClauses = () => mount(clear(clauseBox), clauses.map((c, i) => {
    const ta = h('textarea', { rows: 3, placeholder: 'Write the statement, e.g. "Access rights are reviewed every six months."', oninput: e => c.text = e.target.value }, c.text);
    return h('div.clause.stack.tight', null, h('div.row.start', null, h('span.n', null, String(i + 1)), h('div.grow', null, ta),
      h('button.btn.link', { onclick: () => { clauses.splice(i, 1); drawClauses(); } }, 'Remove')),
      h('div', { style: 'padding-left:38px' }, h('span.muted.small', null, 'Satisfies '), c.controls.map(x => controlChip(x, () => { c.controls = c.controls.filter(y => y.id !== x.id); drawClauses(); })),
        btn('Link controls', () => controlPicker({ title: `Clause ${i + 1} — which controls does it satisfy?`, frameworkId: fwId(), onDone: cs => { cs.forEach(x => { if (!c.controls.some(y => y.id === x.id)) c.controls.push(x); }); drawClauses(); } }), 'sm')));
  }), btn('Add clause', () => { clauses.push({ text: '', controls: [] }); drawClauses(); clauseBox.querySelectorAll('textarea')[clauses.length - 1]?.focus(); }));
  const save = async () => {
    const d = form.read(); if (!d.title.trim()) return toast('Give the policy a title', 'bad');
    const body = { ...d, driver_control_ids: drivers.map(c => c.id), clauses: clauses.filter(c => c.text.trim()).map((c, i) => ({ number: String(i + 1), text: c.text, control_ids: c.controls.map(x => x.id) })) };
    if (imported) body.source = 'imported';
    const r = await attempt(() => id ? api.put('/policies/' + id, body) : api.post('/policies', body), imported ? 'Policy added' : 'Saved');
    if (r) location.hash = '#/policies/' + (r.id || id);
  };
  mount(root, pageHead(id ? `Edit ${p.ref}` : imported ? 'Add an existing policy' : 'Write a policy', imported
    ? 'Enter a policy that is already approved. It is recorded as published.'
    : 'Link each clause to the controls it satisfies.',
    [btn('Cancel', () => history.back()), btn(imported ? 'Save as published' : 'Save draft', save, 'primary')], h('a', { href: '#/policies' }, 'Policies')),
    h('div.stack.loose', null, h('div.card.pad', null, form.el),
      h('div.card', null, h('header', null, h('div', null, h('h3', null, 'Controls the whole policy addresses'), h('div.muted.small', null, 'Optional — when the policy as a whole satisfies a control.'))), h('div.body', null, driverBox)),
      h('div', null, h('h2', { style: 'margin-bottom:10px' }, 'Clauses'), clauseBox)));
  drawDrivers(); drawClauses();
}
