import { h, mount, clear, api, state, pageHead, btn, table, badge, modal, formModal, buildForm, confirmBox, attempt, toast, can, opt, fmtDate, fmtDateTime, pickFile } from '../ui.js';
import { crudPage } from './_crud.js';
import { refreshLookups, switchTenant } from '../app.js';

const MODULES = [['governance', 'Governance'], ['policies', 'Policies'], ['frameworks', 'Frameworks and map'], ['workflow', 'Approval chains'], ['risk', 'Risk'], ['compliance', 'Compliance'], ['audit', 'Audit'], ['reports', 'Reports'], ['admin', 'Administration']];
const LEVELS = [['none', 'No access'], ['view', 'View'], ['edit', 'Edit'], ['manage', 'Manage']];

export async function users(root) {
  const manage = can('admin', 'manage');
  const draw = async () => {
    const rows = await api.get('/admin/users');
    const open = u => formModal({ title: u ? `Edit ${u.name}` : 'Add person', values: u || {}, fields: [{ name: 'name', label: 'Full name', required: true }, u ? null : { name: 'email', label: 'Email (sign-in name)', type: 'email', required: true }, { name: 'job_title', label: 'Job title' },
      { name: 'role_id', label: 'Role', type: 'select', options: state.lookups.roles.map(r => ({ value: r.id, label: `${r.name} (level ${r.level})` })), required: true, hint: 'Sets what they see and which approvals reach them' },
      { name: 'department_id', label: 'Department', type: 'select', options: opt(state.lookups.departments), hint: 'Receives the department\'s evidence requests' },
      { name: 'password', label: u ? 'New password (leave empty to keep)' : 'Initial password', type: 'password', required: !u, hint: 'At least 10 characters' }].filter(Boolean),
      onSubmit: async d => { if (u && !d.password) delete d.password; u ? await api.put('/admin/users/' + u.id, d) : await api.post('/admin/users', d); await refreshLookups(); draw(); } });
    mount(clear(root), pageHead('People', 'Who can sign in, and in which role.', manage ? btn('Add person', () => open(null), 'primary') : null),
      table({ rows, columns: [{ label: 'Name', render: u => [h('b', null, u.name), h('div.muted.small', null, u.email)] }, { label: 'Job title', key: 'job_title' }, { label: 'Role', key: 'role' }, { label: 'Department', key: 'department' }, { label: 'Status', render: u => badge(u.active ? 'active' : 'Disabled', u.active ? 'ok' : 'bad') },
        { label: '', cls: 'actions', render: u => manage ? [h('button.btn.link', { onclick: () => open(u) }, 'Edit'), u.id !== state.me.user.id ? h('button.btn.link', { onclick: async () => { if (await attempt(() => api.put('/admin/users/' + u.id, { active: u.active ? 0 : 1 }))) draw(); } }, u.active ? 'Disable' : 'Enable') : null] : null }] }));
  };
  await draw();
}

export async function roles(root) {
  const manage = can('admin', 'manage');
  const draw = async () => {
    const rows = await api.get('/admin/roles');
    const open = r => { const perms = { ...(r?.permissions || {}) }; const name = h('input', { type: 'text', value: r?.name || '', disabled: !!r?.is_system }); const level = h('input', { type: 'number', min: 0, max: 9, value: r?.level ?? 1 }); const desc = h('input', { type: 'text', value: r?.description || '' });
      modal({ title: r ? `Role — ${r.name}` : 'Add role', wide: true, body: h('div.stack', null, h('div.form-grid', null, h('label.field', null, 'Role name', name), h('label.field', null, 'Approval level', level, h('span.hint', null, 'Higher levels approve later')), h('label.field.full', null, 'Description', desc)),
        h('h3', null, 'Access by module'), h('div.table-wrap', null, h('table.data', null, h('thead', null, h('tr', null, h('th', null, 'Module'), LEVELS.map(l => h('th.center', null, l[1])))), h('tbody', null, MODULES.map(([k, label]) => h('tr', null, h('td', null, label),
          LEVELS.map(([lv]) => h('td.center', null, h('input', { type: 'radio', name: 'p_' + k, checked: (perms[k] || 'none') === lv, disabled: !manage, onchange: () => perms[k] = lv }))))))))),
        actions: [{ label: 'Cancel', onclick: c => c() }, manage ? { label: 'Save role', kind: 'primary', onclick: async close => { const body = { name: name.value, level: Number(level.value), description: desc.value, permissions: perms };
          if (await attempt(() => r ? api.put('/admin/roles/' + r.id, body) : api.post('/admin/roles', body), 'Role saved')) { close(); await refreshLookups(); draw(); } } } : null].filter(Boolean) }); };
    mount(clear(root), pageHead('Roles', 'What each role can see and approve.', manage ? btn('Add role', () => open(null), 'primary') : null),
      table({ rows, onRow: open, columns: [{ label: 'Role', render: r => [h('b', null, r.name), h('div.muted.small', null, r.description || '')] }, { label: 'Level', key: 'level', align: 'num' }, { label: 'People', key: 'users', align: 'right num' },
        { label: 'Access', render: r => MODULES.filter(([k]) => r.permissions[k] && r.permissions[k] !== 'none').map(([k, l]) => h('span.chip', null, l, h('span.fw', null, r.permissions[k]))) },
        { label: '', cls: 'actions', render: r => manage && !r.is_system ? h('button.btn.link', { onclick: async () => { if (await confirmBox('Delete this role?', 'Delete', 'danger') && await attempt(() => api.del('/admin/roles/' + r.id))) { await refreshLookups(); draw(); } } }, 'Delete') : null }] }));
  };
  await draw();
}

export const departments = root => crudPage(root, { title: 'Departments', subtitle: 'Teams that own assets and answer evidence requests.', url: '/admin/departments', noun: 'department', editable: can('admin', 'manage'),
  columns: [{ label: 'Department', render: d => h('b', null, d.name) }, { label: 'People', render: d => state.lookups.users.filter(u => u.department_id === d.id).length, align: 'right num' }], fields: [{ name: 'name', label: 'Department name', required: true, full: true }] }).then(refreshLookups);

export async function settings(root) {
  const s = await api.get('/admin/settings'); const manage = can('admin', 'manage');
  const form = buildForm([
    { name: 'partial_weight', label: 'Credit for a partial match', type: 'select', required: true, options: [{ value: 1, label: '100%' }, { value: 0.75, label: '75%' }, { value: 0.5, label: '50%' }, { value: 0.25, label: '25%' }, { value: 0, label: '0%' }],
      hint: 'How much a partly equivalent control counts towards compliance.' },
    { name: 'risk_appetite', label: 'Risk appetite', type: 'number', min: 1, max: 25, hint: 'Scores up to this value, out of 25, are acceptable' },
    { name: 'ai_provider', label: 'Suggestions', type: 'select', required: true, options: [{ value: 'builtin', label: 'Built-in' }, { value: 'openai-compatible', label: 'AI model' }], hint: 'Suggestions are advice. A person always decides.' },
    { name: 'ai_model', label: 'Model name', placeholder: 'e.g. gpt-4o, llama3.1' }, { name: 'ai_base_url', label: 'API base URL', placeholder: 'https://api.openai.com/v1', full: true }, { name: 'ai_api_key', label: 'API key', type: 'password', full: true, hint: 'Never shown again after saving' }], s);
  mount(root, pageHead('Settings', 'How scores are calculated for your organisation.', manage ? btn('Save settings', async () => { await attempt(() => api.put('/admin/settings', form.read()), 'Settings saved'); }, 'primary') : null), h('div.card.pad', null, form.el));
}

export async function activity(root) {
  const rows = await api.get('/admin/activity');
  mount(root, pageHead('Activity', 'The latest actions in this workspace.'), table({ rows, empty: 'No activity yet', columns: [{ label: 'When', render: r => fmtDateTime(r.at), width: '170px' }, { label: 'Who', render: r => r.user_name || 'System' },
    { label: 'Action', render: r => h('b', null, r.action) }, { label: 'Record', render: r => r.entity_type ? `${r.entity_type.replace(/_/g, ' ')}${r.entity_id ? ' #' + r.entity_id : ''}` : '—' }, { label: 'Detail', render: r => h('span.small', null, r.detail || '') }] }));
}

// ── Platform console (Cryptika staff) ──
const ACCESS = { active: ['Active', 'ok', 'Everyone can sign in and work.'], read_only: ['Read-only', 'warn', 'People can sign in and read everything. Nothing can be changed.'], suspended: ['Suspended', 'bad', 'Nobody from this organisation can sign in. Everyone is signed out straight away.'] };
const PERIODS = [['1h', '1 hour', 3600e3], ['24h', '24 hours', 864e5], ['3d', '3 days', 3 * 864e5], ['7d', '7 days', 7 * 864e5], ['30d', '30 days', 30 * 864e5], ['date', 'Until a date I choose'], ['open', 'Until I lift it']];
const timeLeft = until => { const ms = new Date(until) - Date.now(); if (ms <= 0) return 'ending now'; const d = Math.floor(ms / 864e5), hr = Math.floor(ms % 864e5 / 3600e3), min = Math.max(1, Math.floor(ms % 3600e3 / 6e4)); return d ? `${d} d ${hr} h left` : hr ? `${hr} h ${min} min left` : `${min} min left`; };
const localStamp = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

function accessModal(t, done) {
  let status = t.access.status; const seg = h('div.seg.big'); const hint = h('p.muted', { style: 'margin:0' }); const timing = h('div.form-grid');
  const period = h('select', null, PERIODS.map(([v, l]) => h('option', { value: v, selected: v === (t.access.until ? 'date' : '7d') }, l)));
  const date = h('input', { type: 'datetime-local', min: localStamp(new Date()), value: t.access.until ? localStamp(new Date(t.access.until)) : '' }); const dateField = h('label.field', null, 'Ends on', date);
  const reason = h('input', { type: 'text', value: t.access.reason || '', placeholder: 'e.g. Subscription renewal pending', maxlength: 200 });
  const limit = h('input', { type: 'number', min: 1, value: t.user_limit ?? '', placeholder: 'No limit' });
  const sync = () => { [...seg.children].forEach(b => b.className = b.dataset.k === status ? `on ${b.dataset.k}` : ''); hint.textContent = ACCESS[status][2]; timing.classList.toggle('hidden', status === 'active'); dateField.classList.toggle('hidden', period.value !== 'date'); };
  Object.entries(ACCESS).forEach(([k, [label]]) => seg.append(h('button', { type: 'button', 'data-k': k, onclick: () => { status = k; sync(); } }, label)));
  period.addEventListener('change', sync);
  mount(timing, h('label.field', null, 'For how long', period, h('span.hint', null, 'Access returns by itself when the time is up')), dateField, h('label.field.full', null, 'Reason', reason, h('span.hint', null, 'Shown to people of this organisation')));
  const until = () => { if (status === 'active' || period.value === 'open') return null; if (period.value === 'date') return date.value ? new Date(date.value).toISOString() : undefined; return new Date(Date.now() + PERIODS.find(p => p[0] === period.value)[2]).toISOString(); };
  modal({ title: `Access — ${t.name}`, body: h('div.stack.loose', null, h('div.stack', null, seg, hint), timing,
    h('div.form-grid', null, h('label.field', null, 'People allowed', limit, h('span.hint', null, `${t.users} active now`)),
      h('div.field', null, 'Open sessions', h('div', null, btn(`Sign everyone out (${t.signed_in})`, async () => { const r = await attempt(() => api.post(`/platform/tenants/${t.id}/sign-out`)); if (r) { toast(`${r.ended} session${r.ended === 1 ? '' : 's'} ended`, 'ok'); done(); } }, 'sm danger'))))),
    actions: [{ label: 'Cancel', onclick: c => c() }, { label: 'Save access', kind: 'primary', onclick: async close => { const u = until(); if (u === undefined) return toast('Choose the end date', 'bad');
      if (await attempt(() => api.put('/platform/tenants/' + t.id, { status, until: u, reason: reason.value, user_limit: limit.value === '' ? null : Number(limit.value) }), status === 'active' ? 'Access is open' : `${ACCESS[status][0]} access saved`)) { close(); done(); } } }] });
  sync();
}

export async function tenants(root) {
  const draw = async () => {
    const rows = await api.get('/platform/tenants');
    const importFile = () => pickFile('.json,application/json', async text => { let pkg; try { pkg = JSON.parse(text); } catch { return toast('This is not a company file', 'bad'); }
      const r = await attempt(() => api.post('/platform/import', pkg)); if (!r) return;
      modal({ title: `${r.organisation} is ready`, body: h('div.stack', null, h('dl.kv', null, ...[['Assets', r.assets], ['Vulnerabilities', r.vulnerabilities], ['Threats', r.threats], ['Risks', r.risks], ['Risk assessments', r.assessments], ['Framework controls linked', r.control_links]].filter(x => x[1] != null).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, h('b', null, String(v)))])),
        h('p.muted', null, 'Open the workspace to add its people.')), actions: [{ label: 'Close', onclick: c => c() }, { label: 'Open workspace', kind: 'primary', onclick: c => { c(); switchTenant(r.tenant_id); } }] }); draw(); });
    mount(clear(root), pageHead('Organisations', 'Each organisation works in its own private workspace.', [
      btn('Add organisation', () => formModal({ title: 'Add organisation', intro: 'Creates the workspace and its first administrator.',
        fields: [{ name: 'name', label: 'Organisation name', required: true, full: true }, { name: 'admin_name', label: 'Administrator name', required: true }, { name: 'admin_email', label: 'Administrator email', type: 'email', required: true }, { name: 'admin_password', label: 'Initial password', type: 'password', required: true, hint: 'At least 10 characters', full: true }],
        onSubmit: async d => { await api.post('/platform/tenants', d); toast('Organisation created', 'ok'); draw(); } }), 'primary'),
      btn('Import a company file', importFile)], null,
      { stats: [{ v: rows.length, l: 'Organisations' }, { v: rows.filter(t => t.access.status !== 'active').length, l: 'Restricted' }, { v: rows.reduce((s, t) => s + t.signed_in, 0), l: 'Signed in now' }] }),
      table({ rows, columns: [{ label: 'Organisation', render: t => [h('b', null, t.name), h('div.muted.small', null, [t.sector, t.country].filter(Boolean).join(', ') || 'Profile not completed')] },
        { label: 'People', render: t => t.user_limit ? `${t.users} of ${t.user_limit}` : t.users, align: 'right num' }, { label: 'Signed in', key: 'signed_in', align: 'right num' },
        { label: 'Access', render: t => [badge(ACCESS[t.access.status][0], ACCESS[t.access.status][1]), t.access.status !== 'active' ? h('div.muted.small', { style: 'margin-top:5px' }, t.access.until ? `Until ${fmtDateTime(t.access.until)} · ${timeLeft(t.access.until)}` : 'Until lifted', t.access.reason ? h('div', null, t.access.reason) : null) : null] },
        { label: 'Created', render: t => fmtDate(t.created_at) },
        { label: '', cls: 'actions', render: t => [btn('Open workspace', () => switchTenant(t.id), 'sm primary'), ' ', btn('Manage access', () => accessModal(t, draw), 'sm')] }] }));
  };
  await draw();
}

// People who can open every organisation
export async function team(root) {
  const draw = async () => {
    const rows = await api.get('/platform/admins');
    mount(clear(root), pageHead('Platform team', 'People who can open every organisation.', btn('Add person', () => formModal({ title: 'Add to the platform team', intro: 'This person will be able to open every organisation. Send them the password separately from the link.',
      fields: [{ name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email (sign-in name)', type: 'email', required: true }, { name: 'password', label: 'Initial password', type: 'password', required: true, full: true, hint: 'At least 10 characters' }],
      onSubmit: async d => { await api.post('/platform/admins', d); toast('Person added', 'ok'); draw(); } }), 'primary')),
      table({ rows, columns: [{ label: 'Name', render: u => [h('b', null, u.name), h('div.muted.small', null, u.email)] }, { label: 'Status', render: u => badge(u.active ? 'active' : 'Disabled', u.active ? 'ok' : 'bad') }, { label: 'Added', render: u => fmtDate(u.created_at) },
        { label: '', cls: 'actions', render: u => [h('button.btn.link', { onclick: () => formModal({ title: `New password for ${u.name}`, submitLabel: 'Save password', fields: [{ name: 'password', label: 'New password', type: 'password', required: true, full: true, hint: 'At least 10 characters' }], onSubmit: async d => { await api.put('/platform/admins/' + u.id, d); toast('Password changed', 'ok'); } }) }, 'Set password'),
          u.id !== state.me.user.id ? h('button.btn.link', { onclick: async () => { if (await attempt(() => api.put('/platform/admins/' + u.id, { active: u.active ? 0 : 1 }))) draw(); } }, u.active ? 'Disable' : 'Enable') : null] }] }));
  };
  await draw();
}

export async function rules(root) {
  const draw = async () => {
    const [rows, lib] = await Promise.all([api.get('/platform/rules'), state.lookups ? Promise.resolve(state.lookups.frameworks) : Promise.resolve(null)]);
    const L = state.me.lists; const codes = [...new Set(rows.map(r => r.framework_code))].sort();
    mount(clear(root), pageHead('Regulatory rules', 'Frameworks proposed to an organisation by country and sector.',
      btn('Add rule', () => formModal({ title: 'Add rule', fields: [{ name: 'country', label: 'Country', type: 'select', options: ['*', ...L.countries], required: true, hint: '* applies to every country' }, { name: 'sector', label: 'Sector', type: 'select', options: ['*', ...L.sectors], required: true, hint: '* applies to every sector' },
        { name: 'framework_code', label: 'Framework', type: 'select', options: lib ? lib.filter(f => f.library !== 'CUSTOM').map(f => f.code) : codes, required: true }, { name: 'requirement', label: 'Requirement', type: 'select', options: ['mandatory', 'recommended'], required: true }, { name: 'basis', label: 'Reason shown to the organisation', full: true }],
        onSubmit: async d => { await api.post('/platform/rules', d); draw(); } }), 'primary')),
      table({ rows, columns: [{ label: 'Country', render: r => r.country === '*' ? 'Any' : r.country }, { label: 'Sector', render: r => r.sector === '*' ? 'Any' : r.sector }, { label: 'Framework', render: r => h('b', null, r.framework_code) }, { label: 'Requirement', render: r => badge(r.requirement) }, { label: 'Basis', render: r => h('span.small', null, r.basis || '') },
        { label: '', cls: 'actions', render: r => h('button.btn.link', { onclick: async () => { if (await confirmBox('Delete this rule?', 'Delete', 'danger') && await attempt(() => api.del('/platform/rules/' + r.id))) draw(); } }, 'Delete') }] }));
  };
  await draw();
}
