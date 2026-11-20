import { h, mount, clear, api, state, pageHead, btn, table, badge, modal, confirmBox, attempt, toast, can, fmtDateTime } from '../ui.js';

export async function inbox(root) {
  const rows = await api.get('/workflow/inbox');
  mount(root, pageHead('Approvals', `Waiting for the ${state.me.user.role} role.`),
    table({ rows, empty: 'Nothing is waiting for your decision', emptyHint: 'You will be notified when something reaches you.', onRow: r => location.hash = r.link.slice(1), columns: [
      { label: 'Item', render: r => h('b', null, r.title) }, { label: 'Approval chain', key: 'template_name' }, { label: 'Your step', render: r => badge(r.current.name, 'plum') },
      { label: 'Step', render: r => `${r.stage_index + 1} of ${r.stages.length}`, align: 'num' }, { label: 'Submitted', render: r => fmtDateTime(r.started_at) }] }));
}

export async function history(root) {
  const rows = await api.get('/workflow/instances');
  mount(root, pageHead('Approval history', 'Everything sent for approval, and where it stands.'),
    table({ rows, empty: 'No approvals yet', onRow: r => { if (r.link) location.hash = r.link.slice(1); }, columns: [
      { label: 'Item', render: r => h('b', null, r.title) }, { label: 'Chain', key: 'template_name' }, { label: 'Status', render: r => badge(r.status) },
      { label: 'Position', render: r => r.current ? `${r.current.name} (${r.current.role_name})` : '—' }, { label: 'Submitted', render: r => fmtDateTime(r.started_at) }, { label: 'Closed', render: r => fmtDateTime(r.completed_at) }] }));
}

export async function templates(root) {
  const manage = can('workflow', 'manage');
  const draw = async () => {
    const [tpls, types] = await Promise.all([api.get('/workflow/templates'), api.get('/workflow/entity-types')]);
    const roleName = id => state.lookups.roles.find(r => r.id === id)?.name || 'Role removed';
    const typeLabel = k => types.find(t => t.key === k)?.label || k;
    const open = t => {
      const stages = t ? t.stages.map(s => ({ ...s })) : [{ name: '', role_id: '' }];
      const name = h('input', { type: 'text', value: t?.name || '', placeholder: 'e.g. Policy approval' }); const desc = h('input', { type: 'text', value: t?.description || '' });
      const type = h('select', { disabled: !!t }, types.map(x => h('option', { value: x.key, selected: t?.entity_type === x.key }, x.label)));
      const list = h('div.stack.tight');
      const drawStages = () => mount(clear(list), stages.map((s, i) => h('div.row', null, h('span.ref', { style: 'width:22px' }, String(i + 1)),
        h('input', { type: 'text', value: s.name, placeholder: 'Step name, e.g. Technical review', oninput: e => s.name = e.target.value }),
        h('select', { onchange: e => s.role_id = Number(e.target.value) }, h('option', { value: '' }, 'Approving role…'), state.lookups.roles.map(r => h('option', { value: r.id, selected: r.id === s.role_id }, `${r.name} (level ${r.level})`))),
        h('button.btn.sm', { onclick: () => { if (i > 0) { [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; drawStages(); } }, 'aria-label': 'Move up' }, '↑'),
        h('button.btn.sm.danger', { onclick: () => { stages.splice(i, 1); drawStages(); } }, 'Remove'))), btn('Add step', () => { stages.push({ name: '', role_id: '' }); drawStages(); }, 'sm'));
      drawStages();
      modal({ title: t ? 'Edit approval chain' : 'New approval chain', wide: true, body: h('div.stack', null,
        h('div.form-grid', null, h('label.field', null, 'Name', name), h('label.field', null, 'Applies to', type), h('label.field.full', null, 'Description', desc)),
        h('h3', null, 'Steps, in order'), h('p.muted.small', null, 'Everyone holding the role is notified when it is their turn.'), list),
        actions: [{ label: 'Cancel', onclick: c => c() }, { label: 'Save chain', kind: 'primary', onclick: async close => {
          const body = { name: name.value, description: desc.value, entity_type: type.value, stages };
          if (await attempt(() => t ? api.put('/workflow/templates/' + t.id, body) : api.post('/workflow/templates', body), 'Approval chain saved')) { close(); draw(); } } }] });
    };
    mount(clear(root), pageHead('Approval chains', 'Who approves what, in which order.',
      manage ? btn('New approval chain', () => open(null), 'primary') : null),
      h('div.stack', null, tpls.map(t => h('div.card', null, h('header', null, h('div', null, h('h3', null, t.name), h('div.muted.small', null, `Applies to: ${typeLabel(t.entity_type)}${t.description ? ' — ' + t.description : ''}`)),
        h('div.row', null, t.active ? badge('Active', 'ok') : badge('Inactive', ''), manage ? [!t.active ? btn('Make active', async () => { if (await attempt(() => api.put('/workflow/templates/' + t.id, { active: true }))) draw(); }, 'sm') : null, btn('Edit', () => open(t), 'sm'),
          btn('Delete', async () => { if (await confirmBox('Delete this approval chain?', 'Delete', 'danger') && await attempt(() => api.del('/workflow/templates/' + t.id))) draw(); }, 'sm danger')] : null)),
        h('div.body', null, t.stages.length ? h('div.track', null, h('div.step', null, h('b', null, 'Submitted'), 'Author'), t.stages.map(s => h('div.step', null, h('b', null, s.name), roleName(s.role_id))), h('div.step.done', null, h('b', null, 'Approved'), 'Takes effect'))
          : h('span.muted', null, 'No steps — approved on submission.'))))));
  };
  await draw();
}
