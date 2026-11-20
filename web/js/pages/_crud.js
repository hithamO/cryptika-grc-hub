// A list page with add / edit / delete in a dialog — used for simple record types.
import { h, mount, clear, api, table, pageHead, btn, formModal, confirmBox, attempt } from '../ui.js';

export async function crudPage(root, { title, subtitle, url, columns, fields, editable, noun, extraActions = [], empty, emptyHint, beforeTable, rowActions }) {
  const draw = async () => {
    const rows = await api.get(url);
    const open = row => formModal({ title: row ? `Edit ${noun}` : `Add ${noun}`, fields: typeof fields === 'function' ? fields(row) : fields, values: row || {},
      onSubmit: async d => { row ? await api.put(`${url}/${row.id}`, d) : await api.post(url, d); draw(); } });
    const cols = [...columns];
    if (editable) cols.push({ label: '', cls: 'actions', render: r => [rowActions ? rowActions(r, draw) : null, h('button.btn.link', { onclick: () => open(r) }, 'Edit'),
      h('button.btn.link', { onclick: async () => { if (await confirmBox(`Delete this ${noun}?`, 'Delete', 'danger') && await attempt(() => api.del(`${url}/${r.id}`), 'Deleted')) draw(); } }, 'Delete')] });
    mount(clear(root), pageHead(title, subtitle, [...extraActions.map(a => a(draw)), editable ? btn(`Add ${noun}`, () => open(null), 'primary') : null]),
      beforeTable ? beforeTable(rows, draw) : null, table({ columns: cols, rows, empty: empty || `No ${noun}s yet`, emptyHint }));
  };
  await draw();
}
