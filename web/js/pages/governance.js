import { h, mount, clear, api, state, pageHead, btn, table, badge, buildForm, formModal, confirmBox, attempt, toast, can, opt, fmtDate } from '../ui.js';
import { crudPage } from './_crud.js';
import { refreshLookups } from '../app.js';

export async function profile(root) {
  const p = await api.get('/governance/profile'); const edit = can('governance', 'edit'); const L = state.me.lists;
  const form = buildForm([
    { name: 'legal_name', label: 'Organisation name', required: true }, { name: 'size', label: 'Size', placeholder: 'e.g. 201–500 employees' },
    { name: 'sector', label: 'Sector', type: 'select', options: L.sectors }, { name: 'country', label: 'Country', type: 'select', options: L.countries },
    { name: 'description', label: 'What the organisation does', type: 'textarea' }, { name: 'mission', label: 'Mission', type: 'textarea', rows: 2 }, { name: 'vision', label: 'Vision', type: 'textarea', rows: 2 },
    { name: 'business_objectives', label: 'Business objectives', type: 'textarea' }, { name: 'cyber_objectives', label: 'Cybersecurity objectives', type: 'textarea' }], p);
  const save = async () => { const r = await attempt(() => api.put('/governance/profile', form.read())); if (r) { toast(`Saved. ${r.mandatory_frameworks} mandatory framework${r.mandatory_frameworks === 1 ? '' : 's'} for your sector.`, 'ok'); refreshLookups(); } };
  mount(root, pageHead('Company profile', 'Your sector and country decide which frameworks are mandatory.',
    edit ? btn('Save profile', save, 'primary') : null), h('div.card.pad', null, form.el),
    h('p.muted.small', { style: 'margin-top:10px' }, p.updated_at ? `Last updated ${fmtDate(p.updated_at)}. ` : '', h('a', { href: '#/governance/regulations' }, 'See what applies to you')));
  if (!edit) root.querySelectorAll('input,select,textarea').forEach(i => i.disabled = true);
}

export async function regulations(root) {
  const edit = can('governance', 'edit');
  const draw = async () => {
    const d = await api.get('/governance/regulations');
    const add = async f => { if (await attempt(() => api.post('/governance/regulations', { framework_id: f.id }), `${f.code} added`)) { await refreshLookups(); draw(); } };
    mount(clear(root), pageHead('Laws and regulations', 'What you must follow, and what you choose to follow.'),
      !d.profile?.sector || !d.profile?.country ? h('div.note.warn', { style: 'margin-bottom:14px' }, 'Add your sector and country in the ', h('a', { href: '#/governance/profile' }, 'company profile'), ' to see what is mandatory.') : null,
      h('h2', { style: 'margin-bottom:8px' }, 'In scope'),
      table({ rows: d.adopted, empty: 'No framework in scope yet', onRow: f => location.hash = `#/compliance/frameworks/${f.id}`, columns: [
        { label: 'Framework', render: f => [h('b', null, f.code), h('div.muted.small', null, f.name)] }, { label: 'Region', key: 'region' }, { label: 'Controls', key: 'controls', align: 'right num' },
        { label: 'Requirement', render: f => badge(f.requirement) }, { label: 'Basis', render: f => h('span.small', null, f.basis || '—') },
        { label: '', cls: 'actions', render: f => edit && f.requirement !== 'mandatory' ? h('button.btn.link', { onclick: async () => { if (await confirmBox(`Remove ${f.code} from scope?`, 'Remove', 'danger') && await attempt(() => api.del('/governance/regulations/' + f.id))) { await refreshLookups(); draw(); } } }, 'Remove') : null }] }),
      h('h2', { style: 'margin:26px 0 8px' }, 'Available to add'),
      table({ rows: d.available.sort((a, b) => b.recommended - a.recommended), empty: 'Every framework in the library is already in scope', columns: [
        { label: 'Framework', render: f => [h('b', null, f.code), ' ', f.recommended ? badge('recommended') : null, h('div.muted.small', null, f.name)] },
        { label: 'Area', render: f => f.library === 'PDPL' ? 'Privacy' : 'Cybersecurity' }, { label: 'Region', key: 'region' }, { label: 'Controls', key: 'controls', align: 'right num' },
        { label: 'Why', render: f => h('span.small', null, f.basis || '—') }, { label: '', cls: 'actions', render: f => edit ? btn('Add to scope', () => add(f), 'sm') : null }] }));
  };
  await draw();
}

export const processes = root => crudPage(root, { title: 'Business processes', subtitle: 'What the organisation does, and how critical each activity is.',
  url: '/governance/processes', noun: 'process', editable: can('governance', 'edit'), empty: 'No business process recorded yet',
  columns: [{ label: 'ID', render: r => h('span.ref', null, r.ref) }, { label: 'Process', render: r => [h('b', null, r.name), h('div.muted.small', null, r.description || '')] }, { label: 'Owner', key: 'owner' }, { label: 'Department', key: 'department' },
    { label: 'Criticality', render: r => `${r.criticality || '—'} / 5`, align: 'num' }],
  fields: [{ name: 'name', label: 'Process name', required: true, full: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'owner', label: 'Process owner' },
    { name: 'department_id', label: 'Department', type: 'select', options: opt(state.lookups.departments) }, { name: 'criticality', label: 'Criticality (1 low – 5 critical)', type: 'number', min: 1, max: 5 }] });

export async function committees(root) {
  const edit = can('governance', 'edit');
  const draw = async () => {
    const cs = await api.get('/governance/committees');
    const openC = c => formModal({ title: c ? 'Edit committee' : 'Add committee', values: c || {}, fields: [{ name: 'name', label: 'Committee name', required: true, full: true }, { name: 'purpose', label: 'Purpose', type: 'textarea' }, { name: 'meeting_frequency', label: 'Meets', placeholder: 'e.g. Quarterly' }],
      onSubmit: async d => { c ? await api.put('/governance/committees/' + c.id, d) : await api.post('/governance/committees', d); draw(); } });
    const addM = c => formModal({ title: `Add member — ${c.name}`, fields: [{ name: 'user_id', label: 'Person', type: 'select', options: opt(state.lookups.users), hint: 'Or type a name below' }, { name: 'name', label: 'Name (external member)' },
      { name: 'title', label: 'Job title' }, { name: 'committee_role', label: 'Role in the committee', placeholder: 'Chair, Member, Secretary' }], onSubmit: async d => { await api.post(`/governance/committees/${c.id}/members`, d); draw(); } });
    mount(clear(root), pageHead('Committees', 'Governance bodies and their members.', edit ? btn('Add committee', () => openC(null), 'primary') : null),
      cs.length ? h('div.stack', null, cs.map(c => h('div.card', null, h('header', null, h('div', null, h('h3', null, c.name), h('div.muted.small', null, [c.purpose, c.meeting_frequency && `Meets ${c.meeting_frequency.toLowerCase()}`].filter(Boolean).join(' — '))),
        edit ? h('div.row', null, btn('Add member', () => addM(c), 'sm'), btn('Edit', () => openC(c), 'sm'), btn('Delete', async () => { if (await confirmBox('Delete this committee?', 'Delete', 'danger') && await attempt(() => api.del('/governance/committees/' + c.id))) draw(); }, 'sm danger')) : null),
        table({ rows: c.members, empty: 'No members yet', columns: [{ label: 'Member', render: m => m.user_name || m.name }, { label: 'Position', render: m => m.title || m.role_name || '—' }, { label: 'Committee role', key: 'committee_role' },
          { label: '', cls: 'actions', render: m => edit ? h('button.btn.link', { onclick: async () => { await api.del('/governance/committee-members/' + m.id); draw(); } }, 'Remove') : null }] }))))
        : h('div.card', null, h('div.empty', null, h('b', null, 'No committee yet'), 'Add the committee that approves policies and reviews risk.')));
  };
  await draw();
}
