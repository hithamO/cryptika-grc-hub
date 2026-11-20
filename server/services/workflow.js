'use strict';
// Workflow engine: a template is an ordered list of approval stages, each owned by a role.
// Any module can send an entity through a chain; the engine tracks the current stage, notifies
// the people whose turn it is, records history, and calls the module back on approval / rejection.
const { all, get, run, insert, tx, log, notify } = require('../db');
const { bad, forbidden, notFound } = require('../lib/http');
const { usersWithRole, can } = require('../auth');

const hooks = {};   // entityType -> { label, link(id), onApproved(tenantId, id, user), onRejected(tenantId, id, user) }
const register = (entityType, h) => { hooks[entityType] = h; };
const ENTITY_TYPES = () => Object.entries(hooks).map(([key, h]) => ({ key, label: h.label }));

function decorate(inst) {
  if (!inst) return null;
  inst.stages = JSON.parse(inst.stages);
  inst.current = inst.status === 'in_progress' ? inst.stages[inst.stage_index] : null;
  inst.link = hooks[inst.entity_type]?.link(inst.entity_id) || null;
  return inst;
}
function start(tenantId, user, entityType, entityId, title) {
  return tx(() => {
    const open = get(`SELECT id FROM workflow_instances WHERE tenant_id=? AND entity_type=? AND entity_id=? AND status='in_progress'`, tenantId, entityType, entityId);
    if (open) throw bad('This item is already awaiting approval');
    const tpl = get('SELECT * FROM workflow_templates WHERE tenant_id=? AND entity_type=? AND active=1 ORDER BY id DESC', tenantId, entityType);
    const stages = tpl ? JSON.parse(tpl.stages) : [];
    if (!stages.length) {      // no approval chain defined: approve immediately
      hooks[entityType]?.onApproved?.(tenantId, entityId, user);
      return { status: 'approved', auto: true };
    }
    const roleNames = Object.fromEntries(all('SELECT id,name FROM roles WHERE tenant_id=?', tenantId).map(r => [r.id, r.name]));
    const snap = stages.map(s => ({ name: s.name, role_id: s.role_id, role_name: roleNames[s.role_id] || 'Unassigned role' }));
    const id = insert('workflow_instances', { tenant_id: tenantId, template_id: tpl.id, template_name: tpl.name, entity_type: entityType, entity_id: entityId, title,
      stages: JSON.stringify(snap), stage_index: 0, started_by: user.id });
    insert('workflow_history', { instance_id: id, stage_index: -1, stage_name: 'Submitted', action: 'submit', user_id: user.id });
    notify(tenantId, usersWithRole(tenantId, snap[0].role_id), `Approval needed: ${title}`, `${snap[0].name} — submitted by ${user.name}`, hooks[entityType]?.link(entityId));
    log(tenantId, user.id, 'workflow.submit', entityType, entityId, title);
    return { status: 'in_progress', instanceId: id };
  });
}
function act(tenantId, user, instanceId, action, comment) {
  return tx(() => {
    const inst = decorate(get('SELECT * FROM workflow_instances WHERE id=? AND tenant_id=?', instanceId, tenantId));
    if (!inst) throw notFound();
    if (inst.status !== 'in_progress') throw bad('This approval is already closed');
    const stage = inst.current;
    const isOwner = user.role_id === stage.role_id;
    const override = !isOwner && can(user, 'admin', 'manage');
    if (!isOwner && !override) throw forbidden(`This step belongs to the ${stage.role_name} role`);
    if (!['approve', 'reject'].includes(action)) throw bad('Unknown action');
    if (action === 'reject' && !String(comment || '').trim()) throw bad('Add a comment explaining what needs to change');
    insert('workflow_history', { instance_id: inst.id, stage_index: inst.stage_index, stage_name: stage.name, action, user_id: user.id,
      comment: (override ? '[Administrator override] ' : '') + (comment || '') });
    const h = hooks[inst.entity_type]; const link = h?.link(inst.entity_id);
    if (action === 'reject') {
      run(`UPDATE workflow_instances SET status='rejected', completed_at=datetime('now') WHERE id=?`, inst.id);
      h?.onRejected?.(tenantId, inst.entity_id, user);
      notify(tenantId, [inst.started_by], `Returned: ${inst.title}`, `${stage.name} — ${user.name}: ${comment}`, link);
    } else if (inst.stage_index + 1 >= inst.stages.length) {
      run(`UPDATE workflow_instances SET status='approved', stage_index=?, completed_at=datetime('now') WHERE id=?`, inst.stages.length, inst.id);
      h?.onApproved?.(tenantId, inst.entity_id, user);
      notify(tenantId, [inst.started_by], `Approved: ${inst.title}`, `All ${inst.stages.length} approval steps are complete`, link);
    } else {
      const next = inst.stages[inst.stage_index + 1];
      run('UPDATE workflow_instances SET stage_index=? WHERE id=?', inst.stage_index + 1, inst.id);
      notify(tenantId, usersWithRole(tenantId, next.role_id), `Approval needed: ${inst.title}`, `${next.name} — ${stage.name} approved by ${user.name}`, link);
      notify(tenantId, [inst.started_by], `Progress: ${inst.title}`, `${stage.name} approved; now at ${next.name}`, link);
    }
    log(tenantId, user.id, 'workflow.' + action, inst.entity_type, inst.entity_id, `${stage.name}${comment ? ': ' + comment : ''}`);
    return forEntity(tenantId, inst.entity_type, inst.entity_id);
  });
}
function history(instanceId) {
  return all(`SELECT h.*, u.name user_name FROM workflow_history h LEFT JOIN users u ON u.id=h.user_id WHERE instance_id=? ORDER BY h.id`, instanceId);
}
function forEntity(tenantId, entityType, entityId) {
  const inst = decorate(get('SELECT * FROM workflow_instances WHERE tenant_id=? AND entity_type=? AND entity_id=? ORDER BY id DESC', tenantId, entityType, entityId));
  if (inst) inst.history = history(inst.id);
  return inst;
}
// True when it is this user's turn on the entity's open approval.
function isCurrentApprover(tenantId, user, entityType, entityId) {
  const inst = forEntity(tenantId, entityType, entityId);
  return !!(inst && inst.current && (inst.current.role_id === user.role_id));
}
function inbox(tenantId, user) {
  return all(`SELECT * FROM workflow_instances WHERE tenant_id=? AND status='in_progress' ORDER BY id DESC`, tenantId).map(decorate)
    .filter(i => i.current.role_id === user.role_id);
}
function list(tenantId, status) {
  const rows = status ? all('SELECT * FROM workflow_instances WHERE tenant_id=? AND status=? ORDER BY id DESC LIMIT 300', tenantId, status)
    : all('SELECT * FROM workflow_instances WHERE tenant_id=? ORDER BY id DESC LIMIT 300', tenantId);
  return rows.map(decorate);
}
module.exports = { register, ENTITY_TYPES, start, act, forEntity, isCurrentApprover, inbox, list, history };
