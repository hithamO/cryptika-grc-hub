'use strict';
const { all, get, run, insert, update, log } = require('../db');
const { tenant, need } = require('../auth');
const { bad, notFound } = require('../lib/http');
const workflow = require('../services/workflow');

function cleanStages(ctx, stages) {
  if (!Array.isArray(stages)) throw bad('Stages must be a list');
  const roles = new Set(all('SELECT id FROM roles WHERE tenant_id=?', ctx.t).map(r => r.id));
  return JSON.stringify(stages.map((s, i) => {
    if (!String(s.name || '').trim()) throw bad(`Step ${i + 1} needs a name`);
    if (!roles.has(Number(s.role_id))) throw bad(`Choose the role that approves step ${i + 1}`);
    return { name: String(s.name).trim(), role_id: Number(s.role_id) };
  }));
}
module.exports = router => {
  router.get('/workflow/entity-types', tenant, () => workflow.ENTITY_TYPES());
  router.get('/workflow/templates', need('workflow'), ctx => all('SELECT * FROM workflow_templates WHERE tenant_id=? ORDER BY entity_type, id', ctx.t).map(t => ({ ...t, stages: JSON.parse(t.stages) })));
  router.post('/workflow/templates', need('workflow', 'manage'), ctx => {
    const b = ctx.body; if (!b.name || !b.entity_type) throw bad('Name and record type are required');
    if (!workflow.ENTITY_TYPES().some(e => e.key === b.entity_type)) throw bad('Unknown record type');
    const stages = cleanStages(ctx, b.stages || []);
    run('UPDATE workflow_templates SET active=0 WHERE tenant_id=? AND entity_type=?', ctx.t, b.entity_type);   // one active chain per record type
    const id = insert('workflow_templates', { tenant_id: ctx.t, name: b.name, entity_type: b.entity_type, description: b.description, stages, active: 1 });
    log(ctx.t, ctx.user.id, 'create', 'workflow_template', id, b.name); return { id };
  });
  router.put('/workflow/templates/:id', need('workflow', 'manage'), ctx => {
    const t = get('SELECT * FROM workflow_templates WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!t) throw notFound();
    const b = ctx.body;
    if (b.active) run('UPDATE workflow_templates SET active=0 WHERE tenant_id=? AND entity_type=?', ctx.t, t.entity_type);
    update('workflow_templates', t.id, ctx.t, { name: b.name, description: b.description, stages: b.stages ? cleanStages(ctx, b.stages) : undefined, active: b.active === undefined ? undefined : (b.active ? 1 : 0) });
    log(ctx.t, ctx.user.id, 'update', 'workflow_template', t.id, null);
  });
  router.delete('/workflow/templates/:id', need('workflow', 'manage'), ctx => { run('DELETE FROM workflow_templates WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); });
  router.get('/workflow/inbox', tenant, ctx => workflow.inbox(ctx.t, ctx.user));
  router.get('/workflow/instances', need('workflow'), ctx => workflow.list(ctx.t, ctx.query.status || null));
  router.get('/workflow/instances/:id', tenant, ctx => {
    const i = get('SELECT entity_type, entity_id FROM workflow_instances WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!i) throw notFound();
    return workflow.forEntity(ctx.t, i.entity_type, i.entity_id);
  });
  router.post('/workflow/instances/:id/act', tenant, ctx => workflow.act(ctx.t, ctx.user, Number(ctx.params.id), ctx.body.action, ctx.body.comment));
};
