'use strict';
// Sign-in, session, notifications, dashboard, platform administration and tenant administration.
const { all, get, run, insert, update, tx, log } = require('../db');
const auth = require('../auth');
const { authed, tenant, need, platform, can } = auth;
const { bad, notFound, HttpError } = require('../lib/http');
const { provisionTenant, SECTORS, COUNTRIES, DEFAULT_SETTINGS } = require('../db/seed-defaults');
const coverage = require('../services/coverage');
const workflow = require('../services/workflow');
const { crud } = require('./_crud');

module.exports = router => {
  // Sign-in throttle: at most 8 failed attempts per address and account in 15 minutes (held in memory).
  const failures = new Map();
  router.post('/auth/login', ctx => {
    const { email, password } = ctx.body; const mail = String(email || '').trim().toLowerCase();
    const from = auth.origin(ctx.req); const key = `${from.address}|${mail}`; const now = Date.now();
    const f = (failures.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
    if (f.length >= 8) throw new HttpError(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
    const u = get('SELECT * FROM users WHERE email=? AND active=1', mail);
    if (!u || !auth.verifyPassword(String(password || ''), u.password_hash)) { f.push(now); failures.set(key, f); throw new HttpError(401, 'The email or password is not correct'); }
    failures.delete(key); run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
    if (u.tenant_id) { const access = auth.tenantAccess(u.tenant_id); if (access.status === 'suspended') throw new HttpError(403, auth.accessMessage(access)); }
    // First-run passwords only work on the computer that runs the system — never over the network or through a shared link.
    if (from.remote && String(password) === require('../db/seed-demo').DEMO_PASSWORD) throw new HttpError(403, 'This account still has its first-run password. Change it on the computer that runs the system, then sign in here.');
    const token = auth.createSession(u);
    ctx.res.setHeader('Set-Cookie', auth.cookie(token, 12 * 3600, from.https));
    log(u.tenant_id, u.id, 'login', 'user', u.id, null);
    return { ok: true };
  });
  router.post('/auth/logout', ctx => { if (ctx.user) run('DELETE FROM sessions WHERE token=?', ctx.user.sessionToken); ctx.res.setHeader('Set-Cookie', auth.cookie('', 0)); });
  router.get('/me', ctx => {
    if (!ctx.user) throw new HttpError(401, 'Please sign in');
    const u = ctx.user; const t = ctx.t ? get('SELECT id,name,slug,settings FROM tenants WHERE id=?', ctx.t) : null;
    const perms = Object.fromEntries(auth.MODULES.map(m => [m, u.is_platform_admin ? 'manage' : (u.permissions[m] || 'none')]));
    return {
      user: { id: u.id, name: u.name, email: u.email, role: u.is_platform_admin ? 'Platform Administrator' : u.role_name, role_id: u.role_id, department_id: u.department_id, is_platform_admin: !!u.is_platform_admin },
      tenant: t ? { id: t.id, name: t.name, access: auth.tenantAccess(t.id) } : null, permissions: perms,
      unread: ctx.t ? get('SELECT count(*) n FROM notifications WHERE user_id=? AND tenant_id=? AND is_read=0', u.id, ctx.t).n : 0,
      lists: { sectors: SECTORS, countries: COUNTRIES },
    };
  });
  router.post('/me/password', authed, ctx => {
    const row = get('SELECT password_hash FROM users WHERE id=?', ctx.user.id);
    if (!auth.verifyPassword(String(ctx.body.current || ''), row.password_hash)) throw bad('Your current password is not correct');
    if (String(ctx.body.next || '').length < 10) throw bad('Use at least 10 characters for the new password');
    run('UPDATE users SET password_hash=? WHERE id=?', auth.hashPassword(ctx.body.next), ctx.user.id);
  });

  // Notifications
  router.get('/notifications', tenant, ctx => all('SELECT * FROM notifications WHERE user_id=? AND tenant_id=? ORDER BY id DESC LIMIT 100', ctx.user.id, ctx.t));
  router.post('/notifications/read', tenant, ctx => {
    if (ctx.body.id) run('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', ctx.body.id, ctx.user.id);
    else run('UPDATE notifications SET is_read=1 WHERE user_id=? AND tenant_id=?', ctx.user.id, ctx.t);
  });

  // Dashboard: figures for the charts, limited to what the signed-in person may see
  router.get('/dashboard', tenant, ctx => {
    const u = ctx.user; const t = ctx.t; const out = { profile: get('SELECT legal_name, sector, country FROM company_profile WHERE tenant_id=?', t) };
    out.approvals = workflow.inbox(t, u).slice(0, 6);
    out.evidence_requests = u.department_id ? get(`SELECT count(*) n FROM gap_items gi JOIN gap_assessments ga ON ga.id=gi.assessment_id
      WHERE gi.tenant_id=? AND gi.department_id=? AND gi.status IN ('requested','invalid') AND ga.status='in_progress'`, t, u.department_id).n : 0;
    if (can(u, 'compliance')) {
      out.frameworks = coverage.overview(t).filter(f => f.adopted).map(f => ({ id: f.id, code: f.code, name: f.name, requirement: f.requirement, summary: f.summary }));
      const n = out.frameworks.length || 1; const avg = k => Math.round(out.frameworks.reduce((s, f) => s + k(f.summary), 0) / n * 10) / 10;
      out.overall = { pct: avg(s => s.overall_pct), doc: avg(s => s.doc.pct), impl: avg(s => s.impl.pct) };
      out.gaps = all(`SELECT ga.id, ga.ref, ga.name, f.code framework, (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id) items,
          (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id AND i.status='valid') valid,
          (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id AND i.status='submitted') submitted
        FROM gap_assessments ga JOIN frameworks f ON f.id=ga.framework_id WHERE ga.tenant_id=? AND ga.status!='completed' ORDER BY ga.id DESC LIMIT 4`, t);
    }
    if (can(u, 'risk')) {
      const scored = require('./reports').latestRiskScores(t);
      out.risks = { ...get(`SELECT count(*) total, ifnull(sum(status='pending'),0) pending FROM risks WHERE tenant_id=? AND status IN ('registered','pending')`, t),
        scored: scored.length, above_appetite: scored.filter(r => r.residual > r.appetite).length,
        matrix: scored.map(r => [r.likelihood, r.impact]),
        top: scored.sort((a, b) => (b.residual ?? 0) - (a.residual ?? 0)).slice(0, 4).map(r => ({ ref: r.ref, title: r.title, inherent: r.inherent, inherent_level: r.inherent_level, residual: r.residual, residual_level: r.residual_level })) };
      out.vulns = all(`SELECT severity, count(*) n FROM vulnerabilities WHERE tenant_id=? AND status='open' GROUP BY severity`, t);
    }
    if (can(u, 'audit')) out.findings = all(`SELECT severity, count(*) n FROM findings WHERE tenant_id=? AND status IN ('open','in_progress') GROUP BY severity`, t);
    if (can(u, 'policies')) out.policies = get(`SELECT ifnull(sum(status='published'),0) published, ifnull(sum(status='in_review'),0) in_review, ifnull(sum(status IN ('draft','rejected')),0) draft FROM policies WHERE tenant_id=? AND status!='retired'`, t);
    return out;
  });

  // ── Platform administration (the vendor's console; separate from a tenant's own administration) ──
  router.get('/platform/tenants', platform, () => all(`SELECT t.id, t.name, t.slug, t.created_at, t.user_limit,
    (SELECT count(*) FROM users u WHERE u.tenant_id=t.id AND u.active=1) users, (SELECT count(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.tenant_id=t.id AND s.expires_at > ?) signed_in,
    cp.sector, cp.country FROM tenants t LEFT JOIN company_profile cp ON cp.tenant_id=t.id ORDER BY t.id`, new Date().toISOString()).map(t => ({ ...t, access: auth.tenantAccess(t.id) })));
  router.post('/platform/tenants', platform, ctx => {
    const { name, admin_name, admin_email, admin_password } = ctx.body;
    if (!name || !admin_email || !admin_name) throw bad('Organisation name, administrator name and email are required');
    if (String(admin_password || '').length < 10) throw bad('Use at least 10 characters for the administrator password');
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tenant';
    if (get('SELECT 1 x FROM tenants WHERE slug=?', slug)) throw bad('An organisation with this name already exists');
    if (get('SELECT 1 x FROM users WHERE email=?', String(admin_email).toLowerCase())) throw bad('This email address is already in use');
    return tx(() => {
      const { tenantId, roleId } = provisionTenant(name, slug);
      insert('users', { tenant_id: tenantId, email: String(admin_email).toLowerCase(), name: admin_name, password_hash: auth.hashPassword(admin_password), role_id: roleId['Tenant Administrator'] });
      log(null, ctx.user.id, 'tenant.create', 'tenant', tenantId, name);
      return { id: tenantId };
    });
  });
  // Access control for an organisation: active, read-only or suspended — for a set time or until changed
  router.put('/platform/tenants/:id', platform, ctx => {
    const t = get('SELECT * FROM tenants WHERE id=?', ctx.params.id); if (!t) throw notFound(); const b = ctx.body;
    if (b.name) run('UPDATE tenants SET name=? WHERE id=?', String(b.name), t.id);
    if (b.user_limit !== undefined) { const n = b.user_limit === null || b.user_limit === '' ? null : Number(b.user_limit); if (n !== null && !(n >= 1)) throw bad('The people limit must be 1 or more'); run('UPDATE tenants SET user_limit=? WHERE id=?', n, t.id); }
    if (b.status !== undefined) {
      if (!['active', 'read_only', 'suspended'].includes(b.status)) throw bad('Unknown access state');
      let until = null;
      if (b.status !== 'active' && b.until) { const d = new Date(b.until); if (isNaN(d)) throw bad('The end date is not valid'); if (d <= new Date()) throw bad('The end date must be in the future'); until = d.toISOString(); }
      run('UPDATE tenants SET status=?, access_until=?, access_reason=? WHERE id=?', b.status, until, b.status === 'active' ? null : (String(b.reason || '').trim() || null), t.id);
      if (b.status === 'suspended') run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id=?)', t.id);
      log(t.id, ctx.user.id, 'access.' + b.status, 'tenant', t.id, [until ? 'until ' + until : (b.status === 'active' ? '' : 'until changed'), b.reason].filter(Boolean).join(' — '));
    }
    return { access: auth.tenantAccess(t.id) };
  });
  router.post('/platform/tenants/:id/sign-out', platform, ctx => {
    const r = run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id=?)', ctx.params.id);
    log(Number(ctx.params.id), ctx.user.id, 'access.sign_out_all', 'tenant', Number(ctx.params.id), `${r.changes} session(s) ended`); return { ended: Number(r.changes) };
  });
  router.post('/platform/import', platform, ctx => require('../services/importer').importPackage(ctx.body, ctx.user.id));
  // The platform team: people who can open every organisation
  router.get('/platform/admins', platform, () => all('SELECT id, name, email, active, created_at FROM users WHERE is_platform_admin=1 ORDER BY id'));
  router.post('/platform/admins', platform, ctx => {
    const b = ctx.body; const email = String(b.email || '').trim().toLowerCase(); if (!b.name || !email) throw bad('Name and email are required');
    if (String(b.password || '').length < 10) throw bad('Use at least 10 characters for the password');
    if (get('SELECT 1 x FROM users WHERE email=?', email)) throw bad('This email address is already in use');
    const id = insert('users', { tenant_id: null, email, name: b.name, password_hash: auth.hashPassword(b.password), is_platform_admin: 1 }); log(null, ctx.user.id, 'platform.admin.add', 'user', id, email); return { id };
  });
  router.put('/platform/admins/:id', platform, ctx => {
    const u = get('SELECT * FROM users WHERE id=? AND is_platform_admin=1', ctx.params.id); if (!u) throw notFound(); const b = ctx.body;
    if (b.active !== undefined) { if (u.id === ctx.user.id) throw bad('You cannot disable your own account'); run('UPDATE users SET active=? WHERE id=?', b.active ? 1 : 0, u.id); if (!b.active) run('DELETE FROM sessions WHERE user_id=?', u.id); }
    if (b.password) { if (String(b.password).length < 10) throw bad('Use at least 10 characters for the password'); run('UPDATE users SET password_hash=? WHERE id=?', auth.hashPassword(b.password), u.id); }
    if (b.name) run('UPDATE users SET name=? WHERE id=?', String(b.name), u.id);
  });
  router.post('/platform/switch', platform, ctx => {
    const t = ctx.body.tenant_id ? get('SELECT id FROM tenants WHERE id=?', ctx.body.tenant_id) : null;
    run('UPDATE sessions SET tenant_id=? WHERE token=?', t ? t.id : null, ctx.user.sessionToken);
    log(t ? t.id : null, ctx.user.id, 'tenant.switch', 'tenant', t ? t.id : null, 'Platform administrator entered the workspace');
  });
  router.get('/platform/rules', platform, () => all('SELECT * FROM regulatory_rules ORDER BY country, sector, framework_code'));
  router.post('/platform/rules', platform, ctx => {
    const { country, sector, framework_code, requirement, basis } = ctx.body;
    if (!country || !sector || !framework_code) throw bad('Country, sector and framework are required');
    return { id: insert('regulatory_rules', { country, sector, framework_code, requirement: requirement === 'recommended' ? 'recommended' : 'mandatory', basis }) };
  });
  router.delete('/platform/rules/:id', platform, ctx => { run('DELETE FROM regulatory_rules WHERE id=?', ctx.params.id); });
  router.get('/platform/library', authed, () => ({ stats: JSON.parse(require('../db').meta.get('library_stats') || '[]'), version: require('../db').meta.get('library_version') }));

  // ── Tenant administration ──
  router.get('/admin/users', need('admin'), ctx => all(`SELECT u.id,u.name,u.email,u.job_title,u.role_id,u.department_id,u.active,r.name role,d.name department
    FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN departments d ON d.id=u.department_id WHERE u.tenant_id=? ORDER BY u.name`, ctx.t));
  router.post('/admin/users', need('admin', 'manage'), ctx => {
    const b = ctx.body; const email = String(b.email || '').trim().toLowerCase();
    if (!b.name || !email || !b.role_id) throw bad('Name, email and role are required');
    if (String(b.password || '').length < 10) throw bad('Use at least 10 characters for the password');
    if (!get('SELECT 1 x FROM roles WHERE id=? AND tenant_id=?', b.role_id, ctx.t)) throw bad('Unknown role');
    const lim = get('SELECT user_limit FROM tenants WHERE id=?', ctx.t).user_limit;
    if (lim && get('SELECT count(*) n FROM users WHERE tenant_id=? AND active=1', ctx.t).n >= lim) throw bad(`This organisation is limited to ${lim} people. Disable someone first, or ask for the limit to be raised.`);
    const id = insert('users', { tenant_id: ctx.t, email, name: b.name, job_title: b.job_title, password_hash: auth.hashPassword(b.password), role_id: b.role_id, department_id: b.department_id || null });
    log(ctx.t, ctx.user.id, 'create', 'user', id, email); return { id };
  });
  router.put('/admin/users/:id', need('admin', 'manage'), ctx => {
    const u = get('SELECT id FROM users WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!u) throw notFound();
    const b = ctx.body; const patch = {};
    for (const k of ['name', 'job_title', 'role_id', 'department_id', 'active']) if (b[k] !== undefined) patch[k] = b[k] === '' ? null : b[k];
    if (patch.role_id && !get('SELECT 1 x FROM roles WHERE id=? AND tenant_id=?', patch.role_id, ctx.t)) throw bad('Unknown role');
    if (b.password) { if (String(b.password).length < 10) throw bad('Use at least 10 characters for the password'); patch.password_hash = auth.hashPassword(b.password); }
    update('users', u.id, ctx.t, patch); log(ctx.t, ctx.user.id, 'update', 'user', u.id, null);
  });
  // Everyone signed in may read the people / role / department lists (needed for pickers)
  router.get('/lookups', tenant, ctx => ({
    users: all('SELECT id,name,role_id,department_id FROM users WHERE tenant_id=? AND active=1 ORDER BY name', ctx.t),
    roles: all('SELECT id,name,level FROM roles WHERE tenant_id=? ORDER BY level DESC, name', ctx.t),
    departments: all('SELECT id,name FROM departments WHERE tenant_id=? ORDER BY name', ctx.t),
    frameworks: all(`SELECT f.id,f.code,f.name,f.library,f.region, CASE WHEN tf.framework_id IS NULL THEN 0 ELSE 1 END adopted FROM frameworks f
                     LEFT JOIN tenant_frameworks tf ON tf.framework_id=f.id AND tf.tenant_id=? WHERE f.tenant_id IS NULL OR f.tenant_id=? ORDER BY f.library, f.sort, f.id`, ctx.t, ctx.t),
  }));
  router.get('/admin/roles', need('admin'), ctx => all('SELECT r.*, (SELECT count(*) FROM users u WHERE u.role_id=r.id) users FROM roles r WHERE tenant_id=? ORDER BY level DESC, name', ctx.t)
    .map(r => ({ ...r, permissions: JSON.parse(r.permissions) })));
  const cleanPerms = p => JSON.stringify(Object.fromEntries(auth.MODULES.map(m => [m, auth.LEVELS[p?.[m]] !== undefined ? p[m] : 'none'])));
  router.post('/admin/roles', need('admin', 'manage'), ctx => {
    if (!ctx.body.name) throw bad('Role name is required');
    return { id: insert('roles', { tenant_id: ctx.t, name: ctx.body.name, description: ctx.body.description, level: Number(ctx.body.level) || 1, permissions: cleanPerms(ctx.body.permissions) }) };
  });
  router.put('/admin/roles/:id', need('admin', 'manage'), ctx => {
    const r = get('SELECT * FROM roles WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!r) throw notFound();
    const perms = ctx.body.permissions ? JSON.parse(cleanPerms(ctx.body.permissions)) : null;
    if (perms && r.name === 'Tenant Administrator') perms.admin = 'manage';   // never lock the workspace out of its own administration
    update('roles', r.id, ctx.t, { name: r.is_system ? undefined : ctx.body.name, description: ctx.body.description, level: ctx.body.level !== undefined ? Number(ctx.body.level) : undefined, permissions: perms ? JSON.stringify(perms) : undefined });
  });
  router.delete('/admin/roles/:id', need('admin', 'manage'), ctx => {
    const r = get('SELECT * FROM roles WHERE id=? AND tenant_id=?', ctx.params.id, ctx.t); if (!r) throw notFound();
    if (r.is_system) throw bad('Built-in roles cannot be deleted');
    if (get('SELECT 1 x FROM users WHERE role_id=?', r.id)) throw bad('Move the people holding this role to another role first');
    run('DELETE FROM roles WHERE id=?', r.id);
  });
  crud(router, '/admin/departments', 'departments', { module: 'admin', fields: ['name'], required: ['name'], orderBy: 'name', editLevel: 'manage',
    onDelete: (ctx, row) => { if (get('SELECT 1 x FROM users WHERE department_id=?', row.id)) throw bad('People are still assigned to this department'); } });
  router.get('/admin/settings', need('admin'), ctx => {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(get('SELECT settings FROM tenants WHERE id=?', ctx.t).settings || '{}') };
    return { ...s, ai_api_key: s.ai_api_key ? '••••••••' : '' };
  });
  router.put('/admin/settings', need('admin', 'manage'), ctx => {
    const cur = { ...DEFAULT_SETTINGS, ...JSON.parse(get('SELECT settings FROM tenants WHERE id=?', ctx.t).settings || '{}') };
    const b = ctx.body;
    if (b.partial_weight !== undefined) { const w = Number(b.partial_weight); if (!(w >= 0 && w <= 1)) throw bad('Partial mapping weight must be between 0 and 1'); cur.partial_weight = w; }
    if (b.risk_appetite !== undefined) { const a = Number(b.risk_appetite); if (!(a >= 1 && a <= 25)) throw bad('Risk appetite must be between 1 and 25'); cur.risk_appetite = a; }
    for (const k of ['ai_provider', 'ai_base_url', 'ai_model']) if (b[k] !== undefined) cur[k] = String(b[k]);
    if (b.ai_api_key !== undefined && !/^•+$/.test(b.ai_api_key)) cur.ai_api_key = String(b.ai_api_key);
    run('UPDATE tenants SET settings=? WHERE id=?', JSON.stringify(cur), ctx.t); log(ctx.t, ctx.user.id, 'update', 'settings', null, null);
  });
  router.get('/admin/activity', need('admin'), ctx => all(`SELECT a.*, u.name user_name FROM activity_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 300`, ctx.t));
};
