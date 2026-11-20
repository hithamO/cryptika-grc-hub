import { h, mount, clear, api, state, pageHead, sectionHead, cleanText, btn, table, badge, tabs, formModal, confirmBox, attempt, toast, can, stateTag, controlChip, controlPicker, pickFile, download, modal } from '../ui.js';
import { refreshLookups } from '../app.js';

export async function frameworks(root) {
  const manage = can('frameworks', 'manage');
  const draw = async () => {
    const fws = await api.get('/frameworks');
    const tbl = rows => table({ rows, empty: 'No framework here yet', emptyHint: 'Add your own framework and import its controls from a CSV file.', onRow: f => location.hash = '#/frameworks/' + f.id, columns: [
      { label: 'Framework', render: f => [h('b', null, f.code), h('div.muted.small', null, f.name)] }, { label: 'Region', key: 'region' },
      { label: 'Controls', key: 'controls', align: 'right num' }, { label: 'Assessable', key: 'assessable', align: 'right num' },
      { label: 'In your scope', render: f => f.adopted ? badge(f.requirement) : h('span.muted', null, 'Not in scope') }] });
    mount(clear(root), pageHead('Frameworks', 'Every framework in the library, control by control.',
      [btn('Open the map', () => location.hash = '#/map', 'primary'), manage ? btn('Import template', () => download('/frameworks-template')) : null, manage ? btn('Add own framework', () => formModal({ title: 'Add own framework', intro: 'Only your organisation sees it.',
        fields: [{ name: 'code', label: 'Short code', required: true, placeholder: 'e.g. GROUP-STD' }, { name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }],
        onSubmit: async d => { const r = await api.post('/frameworks', d); await refreshLookups(); location.hash = '#/frameworks/' + r.id; } })) : null], null,
      { stats: [{ v: fws.length, l: 'Frameworks' }, { v: fws.reduce((n, f) => n + f.controls, 0).toLocaleString(), l: 'Controls' }, { v: fws.filter(f => f.adopted).length, l: 'In your scope' }] }),
      tabs([
        { key: 'CYS', label: `Cybersecurity (${fws.filter(f => f.library === 'CYS').length})`, render: () => tbl(fws.filter(f => f.library === 'CYS')) },
        { key: 'PDPL', label: `Privacy (${fws.filter(f => f.library === 'PDPL').length})`, render: () => tbl(fws.filter(f => f.library === 'PDPL')) },
        { key: 'CUSTOM', label: `Own frameworks (${fws.filter(f => f.library === 'CUSTOM').length})`, render: () => tbl(fws.filter(f => f.library === 'CUSTOM')) }]));
  };
  await draw();
}

export async function framework(root, { id }) {
  const manage = can('frameworks', 'manage'); let page = 0, q = '', family = '';
  const body = h('div'); const search = h('input', { type: 'search', placeholder: 'Search control ID or text' }); const famSel = h('select'); let timer;
  const load = async () => {
    const d = await api.get(`/frameworks/${id}/controls?page=${page}&q=${encodeURIComponent(q)}&family=${encodeURIComponent(family)}`);
    if (!famSel.options.length) { mount(famSel, h('option', { value: '' }, 'All families'), ...d.families.map(f => h('option', { value: f.family || '' }, `${f.family || '—'} (${f.n})`))); head(d.framework); }
    mount(clear(body), table({ rows: d.rows, empty: q || family ? 'No control matches' : 'This framework has no controls yet', emptyHint: d.framework.tenant_id ? 'Import them from a CSV file.' : '', onRow: c => location.hash = '#/controls/' + c.id, columns: [
      { label: 'Control', width: '130px', render: c => h('span.ref', null, c.ref) },
      { label: 'Requirement', render: c => [c.title ? h('b', null, c.title) : null, h('div.small.muted', null, cleanText(c.description) + ((c.description || '').length >= 320 ? '…' : ''))] },
      { label: 'Type', render: c => c.assessable ? (c.level ? badge(c.level, 'plum') : c.applicable_role ? h('span.small', null, c.applicable_role) : '') : badge(c.record_type === 'WITHDRAWN' ? 'Withdrawn' : c.record_type === 'HEADING_NO_TEXT' ? 'Heading' : 'Reference only', '') },
      { label: 'Equivalents', render: c => c.links ? `${c.links}` : h('span.muted', null, '—'), align: 'right nowrap' }] }),
      h('div.row.between', { style: 'margin-top:10px' }, h('span.muted.small', null, `${d.total.toLocaleString()} controls · page ${page + 1} of ${Math.max(1, Math.ceil(d.total / d.size))}`),
        h('div.row', null, btn('Previous', () => { page--; load(); }, 'sm' + (page <= 0 ? ' hidden' : '')), btn('Next', () => { page++; load(); }, 'sm' + ((page + 1) * d.size >= d.total ? ' hidden' : '')))));
  };
  const headBox = h('div');
  const head = f => mount(clear(headBox), pageHead(f.code, f.name + (f.description ? ' — ' + f.description : ''), f.tenant_id && manage ? [
    btn('Import controls from CSV', () => pickFile('.csv,text/csv', async text => { const r = await attempt(() => api.post(`/frameworks/${id}/import`, { csv: text })); if (r) { showImport(r); load(); } }), 'primary'),
    btn('Delete framework', async () => { if (await confirmBox('Delete this framework and its controls?', 'Delete', 'danger') && await attempt(() => api.del('/frameworks/' + id), 'Deleted')) { await refreshLookups(); location.hash = '#/frameworks'; } }, 'danger')] : null,
    h('a', { href: '#/frameworks' }, 'Frameworks and control map')));
  const showImport = r => modal({ title: 'Import finished', body: h('div.stack', null, h('p', null, `${r.created} controls created, ${r.updated} updated, ${r.links} mappings added.`),
    r.problems.length ? h('div.note.warn', null, h('b', null, `${r.problems.length} row(s) need attention`), h('div.small.pre', null, r.problems.slice(0, 30).join('\n'))) : null), actions: [{ label: 'Close', kind: 'primary', onclick: c => c() }] });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value; page = 0; load(); }, 250); });
  famSel.addEventListener('change', () => { family = famSel.value; page = 0; load(); });
  mount(root, headBox, h('div.toolbar', null, search, famSel), body);
  await load();
}

export async function control(root, { id }) {
  const manage = can('frameworks', 'manage');
  const draw = async () => {
    const d = await api.get('/controls/' + id); const c = d.control; let adoptedOnly = false;
    const linksBox = h('div'); const groupsBox = h('div');
    const drawLinks = () => {
      const rows = d.links.filter(l => !adoptedOnly || l.adopted); const by = new Map();
      rows.forEach(l => { if (!by.has(l.framework)) by.set(l.framework, []); by.get(l.framework).push(l); });
      mount(clear(linksBox), by.size ? table({ rows: [...by.entries()], columns: [
        { label: 'Framework', width: '210px', render: ([fw, ls]) => [h('b', null, fw), ' ', ls[0].adopted ? badge('In scope', 'plum') : null] },
        { label: 'Equivalent controls', render: ([, ls]) => ls.map(l => h('span.chip', { class: l.confidence === 'Direct' ? 'direct' : l.tenant_id ? 'own' : '', title: `${l.title || ''}${l.title ? ' — ' : ''}${l.confidence === 'Tenant' ? 'your own mapping' : l.confidence.toLowerCase() + ' match'}` },
          h('a', { href: '#/controls/' + l.id }, l.ref), l.tenant_id && manage ? h('button', { 'aria-label': 'Remove mapping', onclick: async () => { if (await attempt(() => api.del(`/controls/${id}/links/${l.id}`), 'Mapping removed')) draw(); } }, '×') : null)) }] })
        : h('div.card', null, h('div.empty', null, h('b', null, adoptedOnly ? 'No equivalent in your frameworks' : 'No equivalent control'), 'This control stands on its own.')));
    };
    const pos = d.position;
    const explain = (dim, label, own) => h('div.card.pad.stack.tight', null, h('div.row.between', null, h('h3', null, label), stateTag(dim.state)),
      dim.state === 'direct' ? own : dim.state === 'gap' ? h('span.muted.small', null, 'Nothing covers this control yet.')
        : h('div.small', null, dim.state === 'inherited_partial' ? 'Partly covered by ' : 'Covered by ', dim.via.map(v => controlChip(v))));
    mount(clear(root), pageHead(`${c.framework} ${c.ref}`, c.title || '', [btn('View in the map', () => location.hash = '#/map/' + c.id, 'primary')], [h('a', { href: '#/frameworks' }, 'Frameworks'), ' / ', h('a', { href: '#/frameworks/' + c.framework_id }, c.framework)]),
      h('div.card.pad.stack', null, h('div.pre', { style: 'font-size:15px;color:var(--z700);max-width:90ch' }, cleanText(c.description) || 'No text is available for this entry.'),
        h('div.row.wrap', null, c.assessable ? null : badge('Reference only', ''), c.level ? badge(c.level, 'plum') : null, c.applicable_role ? badge(c.applicable_role, 'info') : null, null)),
      pos ? [sectionHead('Where you stand'), pos.na ? h('div.note', null, 'Marked as not applicable.') : h('div.grid.g2', null,
        explain(pos.doc, 'Documentation', h('div.small', null, 'Covered by: ', pos.doc.policies.map(p => h('a', { href: '#/policies/' + p.policy_id, style: 'margin-right:10px' }, `${p.ref} ${p.title}${p.clause ? ' §' + p.clause : ''}`)))),
        explain(pos.impl, 'Implementation', h('div.small', null, `Validated in ${pos.impl.source?.source || ''}`)))] : null,
      sectionHead(`Equivalent controls`, `${d.links.length} in ${new Set(d.links.map(l => l.framework)).size} other frameworks`,
        h('div.row.wrap', null, h('div.legend', null, h('span.direct', { style: '--c:var(--plum)' }, 'Direct match'), h('span', null, 'Partial match')), h('label.check.small', null, h('input', { type: 'checkbox', onchange: e => { adoptedOnly = e.target.checked; drawLinks(); } }), 'Only my frameworks'),
          manage ? btn('Add own mapping', () => controlPicker({ title: `Map ${c.framework} ${c.ref} to…`, multiple: false, onDone: async ([t]) => { if (await attempt(() => api.post(`/controls/${id}/links`, { target_id: t.id }), 'Mapping added')) draw(); } }), 'sm') : null)),
      linksBox,
      d.map_rows.length ? [sectionHead('Mapping groups', `${d.map_rows.length} groups start from this control`), groupsBox] : null);
    const drawGroups = all => mount(clear(groupsBox), table({ rows: all ? d.map_rows : d.map_rows.slice(0, 4), columns: [{ label: 'Group', width: '130px', render: r => h('span.ref', null, r.cryptika_id) }, { label: 'Match', render: r => badge(r.confidence), width: '110px' },
      { label: 'What the group covers', render: r => [r.ai_description ? h('div', { style: 'color:var(--z900)' }, r.ai_description) : null,
        h('div.small', { style: 'margin-top:6px' }, Object.entries(r.members).map(([fw, refs]) => h('span', { style: 'margin-right:14px' }, h('b', { style: 'font-size:12.5px' }, fw + ' '), refs.join(', '))))] }] }),
      !all && d.map_rows.length > 4 ? h('div.center', { style: 'margin-top:14px' }, btn(`Show all ${d.map_rows.length} groups`, () => drawGroups(true))) : null);
    drawGroups(false);
    drawLinks();
  };
  await draw();
}
