import { h, mount, clear, api, state, pageHead, btn, table, badge, tabs, modal, formModal, confirmBox, attempt, toast, can, opt, fmtDate, pickFile, controlChip, controlPicker, evidencePanel, download } from '../ui.js';

const edit = () => can('audit', 'edit');

export async function questions(root) {
  const draw = async () => {
    const rows = await api.get('/audit/questions');
    const open = q => { let controls = q ? [...q.controls] : []; const box = h('div');
      const f = { topic: h('input', { type: 'text', value: q?.topic || '', placeholder: 'e.g. Access management' }), question: h('textarea', { rows: 2 }, q?.question || ''), guidance: h('textarea', { rows: 2 }, q?.guidance || ''),
        expected_evidence: h('input', { type: 'text', value: q?.expected_evidence || '' }), auditee: h('input', { type: 'text', value: q?.auditee || '', placeholder: 'Who is normally asked, e.g. IT Manager' }) };
      const drawC = () => mount(clear(box), controls.map(c => controlChip(c, () => { controls = controls.filter(x => x.id !== c.id); drawC(); })), btn('Link controls', () => controlPicker({ title: 'Which controls does a "Yes" to this question satisfy?', onDone: cs => { cs.forEach(c => { if (!controls.some(x => x.id === c.id)) controls.push(c); }); drawC(); } }), 'sm'));
      drawC();
      modal({ title: q ? 'Edit question' : 'Add question', wide: true, body: h('div.form-grid', null, h('label.field', null, 'Topic', f.topic), h('label.field', null, 'Usual auditee', f.auditee), h('label.field.full', null, 'Question *', f.question),
        h('label.field.full', null, 'Guidance for the auditor', f.guidance), h('label.field.full', null, 'Expected evidence', f.expected_evidence), h('div.full', null, h('div.field', null, 'Asked to satisfy'), box, h('div.muted.small', null, 'The question is reused when you audit an equivalent framework.'))),
        actions: [{ label: 'Cancel', onclick: c => c() }, { label: 'Save question', kind: 'primary', onclick: async close => { const body = { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), control_ids: controls.map(c => c.id) };
          if (await attempt(() => q ? api.put('/audit/questions/' + q.id, body) : api.post('/audit/questions', body), 'Saved')) { close(); draw(); } } }] }); };
    mount(clear(root), pageHead('Question pool', 'Reusable audit questions, each tied to the control it tests.', edit() ? [btn('Import template', () => download('/audit/questions-template')),
      btn('Import CSV', () => pickFile('.csv,text/csv', async text => { const r = await attempt(() => api.post('/audit/questions/import', { csv: text })); if (r) { toast(`${r.created} questions imported${r.problems.length ? `, ${r.problems.length} problem(s)` : ''}`, r.problems.length ? '' : 'ok'); if (r.problems.length) modal({ title: 'Rows that need attention', body: h('div.small.pre', null, r.problems.join('\n')), actions: [{ label: 'Close', onclick: c => c() }] }); draw(); } })),
      btn('Add question', () => open(null), 'primary')] : null),
      table({ rows, empty: 'The question pool is empty', emptyHint: 'Import a CSV file or add questions one by one.', columns: [{ label: 'Topic', key: 'topic', width: '150px' }, { label: 'Question', render: q => [h('b', null, q.question), q.expected_evidence ? h('div.muted.small', null, `Evidence: ${q.expected_evidence}`) : null] },
        { label: 'Auditee', key: 'auditee' }, { label: 'Tests', render: q => q.controls.length ? q.controls.map(c => controlChip(c)) : h('span.muted', null, 'Not linked') },
        { label: '', cls: 'actions', render: q => edit() ? [h('button.btn.link', { onclick: () => open(q) }, 'Edit'), h('button.btn.link', { onclick: async () => { if (await confirmBox('Delete this question?', 'Delete', 'danger') && await attempt(() => api.del('/audit/questions/' + q.id))) draw(); } }, 'Delete')] : null }] }));
  };
  await draw();
}

export async function audits(root) {
  const rows = await api.get('/audit/audits');
  const create = () => formModal({ title: 'New audit', wide: true, intro: 'Questions are pulled in for every control of the framework you choose.',
    fields: [{ name: 'title', label: 'Audit title', required: true, full: true }, { name: 'framework_id', label: 'Framework audited', type: 'select', options: state.lookups.frameworks.map(f => ({ value: f.id, label: f.code })) }, { name: 'lead_id', label: 'Lead auditor', type: 'select', options: opt(state.lookups.users) },
      { name: 'start_date', label: 'Start', type: 'date' }, { name: 'end_date', label: 'End', type: 'date' }, { name: 'objective', label: 'Objective', type: 'textarea', rows: 2 }, { name: 'scope', label: 'Scope', type: 'textarea', rows: 2 },
      { name: 'include_generated', label: 'Add a standard question for controls that have none', type: 'checkbox', full: true }], values: { include_generated: true },
    onSubmit: async d => { const r = await api.post('/audit/audits', d); toast(`${r.from_pool} questions from the pool, ${r.generated} standard questions`, 'ok'); location.hash = '#/audit/audits/' + r.id; } });
  mount(root, pageHead('Audits', 'Plan, run and close audits.', edit() ? btn('New audit', create, 'primary') : null),
    table({ rows, empty: 'No audit yet', onRow: r => location.hash = '#/audit/audits/' + r.id, columns: [{ label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Audit', render: r => [h('b', null, r.title), h('div.muted.small', null, r.framework || 'No framework')] },
      { label: 'Status', render: r => badge(r.status) }, { label: 'Lead', key: 'lead_name' }, { label: 'Dates', render: r => r.start_date ? `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` : '—' },
      { label: 'Answered', render: r => `${r.answered} / ${r.items}`, align: 'right num' }, { label: 'Open findings', render: r => r.open_findings ? badge(String(r.open_findings), 'warn') : '0', align: 'right' }] }));
}

export async function audit(root, { id }) {
  let tab = 'plan', fSession = '', fState = '';
  const draw = async () => {
    const a = await api.get('/audit/audits/' + id); const ed = edit() && a.status !== 'closed';
    const plan = () => {
      const sessForm = s => formModal({ title: s ? 'Edit session' : 'Add session', values: s || { duration_min: 60 }, fields: [{ name: 'title', label: 'Session', required: true, full: true, placeholder: 'e.g. Access management with IT' }, { name: 'auditee', label: 'Auditee' }, { name: 'department_id', label: 'Department', type: 'select', options: opt(state.lookups.departments) },
        { name: 'session_date', label: 'Date', type: 'date' }, { name: 'start_time', label: 'Start time', type: 'time' }, { name: 'duration_min', label: 'Duration (minutes)', type: 'number', min: 15, step: 15 }, { name: 'location', label: 'Location' }],
        onSubmit: async d => { s ? await api.put('/audit/sessions/' + s.id, d) : await api.post(`/audit/audits/${id}/sessions`, d); draw(); } });
      return h('div.stack.loose', null, h('div.card.pad', null, h('dl.kv', null, h('dt', null, 'Framework'), h('dd', null, a.framework || '—'), h('dt', null, 'Lead auditor'), h('dd', null, a.lead_name || '—'), h('dt', null, 'Dates'), h('dd', null, a.start_date ? `${fmtDate(a.start_date)} – ${fmtDate(a.end_date)}` : '—'),
        h('dt', null, 'Objective'), h('dd.pre', null, a.objective || '—'), h('dt', null, 'Scope'), h('dd.pre', null, a.scope || '—'), h('dt', null, 'People to meet'), h('dd', null, a.suggested_auditees.length ? a.suggested_auditees.join(', ') : h('span.muted', null, '—')))),
        h('div', null, h('div.row.between', { style: 'margin-bottom:8px' }, h('h2', null, 'Sessions'), ed ? btn('Add session', () => sessForm(null), 'sm') : null),
          table({ rows: a.sessions, empty: 'No session scheduled', emptyHint: 'Add the meetings, then assign questions to them.', columns: [{ label: 'Session', render: s => h('b', null, s.title) }, { label: 'Auditee', render: s => [s.auditee, s.department].filter(Boolean).join(' · ') || '—' },
            { label: 'When', render: s => s.session_date ? `${fmtDate(s.session_date)} ${s.start_time || ''}` : '—' }, { label: 'Duration', render: s => s.duration_min ? `${s.duration_min} min` : '—' }, { label: 'Questions', render: s => a.items.filter(i => i.session_id === s.id).length, align: 'right num' },
            { label: '', cls: 'actions', render: s => ed ? [h('button.btn.link', { onclick: () => sessForm(s) }, 'Edit'), h('button.btn.link', { onclick: async () => { if (await attempt(() => api.del('/audit/sessions/' + s.id))) draw(); } }, 'Delete')] : null }] })));
    };
    const field = () => {
      const sel = new Set(); const rows = a.items.filter(i => (!fSession || (fSession === 'none' ? !i.session_id : String(i.session_id) === fSession)) && (!fState || (fState === 'pending' ? i.answer === 'pending' : i.answer !== 'pending')));
      const set = async (i, patch) => { const r = await attempt(() => api.put('/audit/items/' + i.id, patch)); if (r) { if (r.finding_ref && patch.answer) toast(`Finding ${r.finding_ref} raised`, ''); draw(); } };
      const ans = i => h('div.seg', null, [['yes', 'Yes'], ['partial', 'Partly'], ['no', 'No'], ['na', 'N/A']].map(([v, l]) => h('button', { class: i.answer === v ? `on ${v}` : '', disabled: !ed, onclick: () => ed && set(i, { answer: i.answer === v ? 'pending' : v }) }, l)));
      const openItem = i => modal({ title: `${i.control_framework || ''} ${i.control_ref || ''}`.trim() || 'Question', wide: true, body: h('div.stack', null, h('p', null, h('b', null, i.question)), i.expected_evidence ? h('div.note', null, h('b', null, 'Expected evidence: '), i.expected_evidence) : null,
        h('label.field', null, 'Auditor notes', h('textarea', { rows: 3, disabled: !ed, onchange: e => api.put('/audit/items/' + i.id, { notes: e.target.value }) }, i.notes || '')),
        h('label.check', null, h('input', { type: 'checkbox', checked: !!i.evidence_pending, disabled: !ed, onchange: e => api.put('/audit/items/' + i.id, { evidence_pending: e.target.checked }) }), 'Evidence promised, not received yet'),
        h('h3', null, 'Evidence'), evidencePanel('audit_item', i.id, ed)), actions: [{ label: 'Done', kind: 'primary', onclick: c => { c(); draw(); } }] });
      return h('div', null, h('div.toolbar', null, h('select', { onchange: e => { fSession = e.target.value; draw(); } }, h('option', { value: '' }, 'All sessions'), h('option', { value: 'none', selected: fSession === 'none' }, 'Not in a session'), a.sessions.map(s => h('option', { value: s.id, selected: String(s.id) === fSession }, s.title))),
        h('select', { onchange: e => { fState = e.target.value; draw(); } }, [['', 'All questions'], ['pending', 'Not answered'], ['answered', 'Answered']].map(([v, l]) => h('option', { value: v, selected: v === fState }, l))),
        h('span.muted.small', null, `${a.items.filter(i => i.answer !== 'pending').length} of ${a.items.length} answered`), h('span.grow'),
        ed && a.sessions.length ? [h('span.muted.small', null, 'Move ticked to'), h('select', { onchange: async e => { if (!sel.size) { toast('Tick the questions first', 'bad'); e.target.value = ''; return; } if (await attempt(() => api.post(`/audit/audits/${id}/assign-session`, { session_id: Number(e.target.value) || null, item_ids: [...sel] }), 'Moved')) draw(); } },
          h('option', { value: '' }, 'Session…'), a.sessions.map(s => h('option', { value: s.id }, s.title)))] : null,
        ed ? btn('Add question', () => formModal({ title: 'Add a question to this audit', fields: [{ name: 'question', label: 'Question', type: 'textarea', required: true }, { name: 'expected_evidence', label: 'Expected evidence', full: true }, { name: 'auditee', label: 'Auditee' }], onSubmit: async d => { await api.post(`/audit/audits/${id}/items`, d); draw(); } }), 'sm') : null),
        table({ rows: rows.slice(0, 300), empty: 'No question matches this filter', columns: [ed ? { label: '', width: '28px', render: i => h('input', { type: 'checkbox', onchange: e => e.target.checked ? sel.add(i.id) : sel.delete(i.id) }) } : null,
          { label: 'Control', width: '120px', render: i => i.control_ref ? h('a.ref', { href: '#/controls/' + i.control_id }, i.control_ref) : '—' },
          { label: 'Question', render: i => [h('div', null, i.question), h('div.muted.small', null, [i.auditee && `Ask: ${i.auditee}`, i.expected_evidence && `Evidence: ${i.expected_evidence}`, i.notes && `Note: ${i.notes}`].filter(Boolean).join(' · '))] },
          { label: 'Answer', width: '215px', render: i => [ans(i), i.finding_ref ? h('div.small', { style: 'margin-top:4px' }, badge(`Finding ${i.finding_ref}`, 'bad')) : null, i.evidence_pending ? h('div.small.muted', null, 'Evidence to follow') : null] },
          { label: '', cls: 'actions', render: i => h('button.btn.link', { onclick: () => openItem(i) }, i.files ? `Notes · ${i.files} file(s)` : 'Notes and evidence') }].filter(Boolean) }),
        rows.length > 300 ? h('p.muted.small', null, `Showing 300 of ${rows.length}; filter by session to see the rest.`) : null);
    };
    const finds = () => table({ rows: a.findings, empty: 'No findings', emptyHint: 'A “No” answer raises one automatically.', onRow: () => location.hash = '#/audit/findings', columns: [{ label: 'ID', render: f => h('span.ref', null, f.ref) }, { label: 'Finding', render: f => [h('b', null, f.title), h('div.muted.small.pre', null, (f.description || '').slice(0, 200))] },
      { label: 'Type', render: f => badge(f.finding_type === 'potential' ? 'Potential' : 'Confirmed', f.finding_type === 'potential' ? 'warn' : 'bad') }, { label: 'Severity', render: f => badge(f.severity) }, { label: 'Status', render: f => badge(f.status) }] });
    const next = { planned: ['fieldwork', 'Start fieldwork'], fieldwork: ['reporting', 'Move to reporting'], reporting: ['closed', 'Close audit'] }[a.status];
    mount(clear(root), pageHead(a.title, a.framework ? `${a.framework} · ${badge(a.status).textContent}` : badge(a.status).textContent, [edit() && next ? btn(next[1], async () => { if (await attempt(() => api.put('/audit/audits/' + id, { status: next[0] }))) draw(); }, 'primary') : null], [h('a', { href: '#/audit/audits' }, 'Audits'), ` / ${a.ref}`], { stats: [{ v: a.items.filter(i => i.answer !== 'pending').length, unit: ` / ${a.items.length}`, l: 'Answered' }, { v: a.findings.filter(f => f.status !== 'closed').length, l: 'Open findings' }] }),
      tabs([{ key: 'plan', label: 'Plan and schedule', render: () => { tab = 'plan'; return plan(); } }, { key: 'field', label: `Fieldwork (${a.items.length})`, render: () => { tab = 'field'; return field(); } }, { key: 'find', label: `Findings (${a.findings.filter(f => f.status !== 'closed').length})`, render: () => { tab = 'find'; return finds(); } }], tab));
  };
  await draw();
}

export async function findings(root) {
  const draw = async () => {
    const rows = await api.get('/audit/findings');
    const open = f => { const box = h('div.stack.tight');
      const capas = () => mount(clear(box), f.capas.length ? f.capas.map(c => h('div.row', null, h('div.grow', null, h('b', null, c.action), h('div.muted.small', null, [c.owner, c.due_date && `due ${fmtDate(c.due_date)}`, c.verification_note].filter(Boolean).join(' · '))), badge(c.status),
        edit() && c.status === 'open' ? btn('Mark done', async () => { await api.put('/audit/capas/' + c.id, { status: 'done' }); c.status = 'done'; capas(); }, 'sm') : null,
        edit() && c.status === 'done' ? btn('Verify', async () => { await api.put('/audit/capas/' + c.id, { status: 'verified' }); c.status = 'verified'; capas(); }, 'sm ok') : null)) : h('span.muted.small', null, 'No corrective action yet.'),
        edit() ? h('div', null, btn('Add corrective action', () => formModal({ title: 'Corrective action', fields: [{ name: 'action', label: 'Action', type: 'textarea', required: true }, { name: 'owner', label: 'Owner' }, { name: 'due_date', label: 'Due', type: 'date' }],
          onSubmit: async d => { const r = await api.post(`/audit/findings/${f.id}/capas`, d); f.capas.push({ id: r.id, ...d, status: 'open' }); capas(); } }), 'sm')) : null);
      capas();
      const sev = h('select', { disabled: !edit() }, ['Critical', 'High', 'Medium', 'Low'].map(s => h('option', { selected: f.severity === s }, s))); const st = h('select', { disabled: !edit() }, ['open', 'in_progress', 'resolved', 'closed'].map(s => h('option', { value: s, selected: f.status === s }, badge(s).textContent)));
      const owner = h('input', { type: 'text', value: f.owner || '', disabled: !edit() }); const due = h('input', { type: 'date', value: f.due_date || '', disabled: !edit() });
      modal({ title: `${f.ref} — ${f.title}`, wide: true, body: h('div.stack', null, h('p.pre', null, f.description || ''), h('div.form-grid', null, h('label.field', null, 'Severity', sev), h('label.field', null, 'Status', st), h('label.field', null, 'Owner', owner), h('label.field', null, 'Due date', due)),
        h('h3', null, 'Corrective actions'), box, h('h3', null, 'Evidence'), evidencePanel('finding', f.id, edit())),
        actions: [{ label: 'Close', onclick: c => { c(); draw(); } }, edit() ? { label: 'Save', kind: 'primary', onclick: async close => { if (await attempt(() => api.put('/audit/findings/' + f.id, { severity: sev.value, status: st.value, owner: owner.value, due_date: due.value }), 'Saved')) { close(); draw(); } } } : null].filter(Boolean) }); };
    mount(clear(root), pageHead('Findings', 'What audits found, and the actions that close them.', [btn('Export', () => download('/reports/export/findings')),
      edit() ? btn('Add finding', () => formModal({ title: 'Add finding', fields: [{ name: 'title', label: 'Finding', required: true, full: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'severity', label: 'Severity', type: 'select', options: ['Critical', 'High', 'Medium', 'Low'], required: true }, { name: 'owner', label: 'Owner' }, { name: 'due_date', label: 'Due', type: 'date' }], values: { severity: 'Medium' },
        onSubmit: async d => { await api.post('/audit/findings', d); draw(); } }), 'primary') : null]),
      table({ rows, empty: 'No findings', onRow: open, columns: [{ label: 'ID', render: f => h('span.ref', null, f.ref) }, { label: 'Finding', render: f => [h('b', null, f.title), h('div.muted.small', null, [f.audit_ref, f.control_ref && `${f.control_framework} ${f.control_ref}`].filter(Boolean).join(' · '))] },
        { label: 'Type', render: f => badge(f.finding_type === 'potential' ? 'Potential' : 'Confirmed', f.finding_type === 'potential' ? 'warn' : 'bad') }, { label: 'Severity', render: f => badge(f.severity) }, { label: 'Status', render: f => badge(f.status) },
        { label: 'Actions', render: f => f.capas.length ? `${f.capas.filter(c => c.status === 'verified').length} / ${f.capas.length} verified` : h('span.muted', null, 'None'), align: 'right' }, { label: 'Owner', key: 'owner' }, { label: 'Due', render: f => fmtDate(f.due_date) }] }));
  };
  await draw();
}
