// Application shell: sign-in, floating navigation, routing.
import { h, mount, clear, api, state, toast, can, attempt, formModal, fmtDateTime, btn, icon, logo, lens, calm } from './ui.js';
import * as dashboard from './pages/dashboard.js';
import * as governance from './pages/governance.js';
import * as library from './pages/library.js';
import * as policies from './pages/policies.js';
import * as workflow from './pages/workflow.js';
import * as risk from './pages/risk.js';
import * as compliance from './pages/compliance.js';
import * as audit from './pages/audit.js';
import * as reports from './pages/reports.js';
import * as admin from './pages/admin.js';
import * as map from './pages/map.js';

const app = document.getElementById('app');

// [pattern, page function, navigation key]
const ROUTES = [
  ['/', dashboard.home, 'home'], ['/approvals', workflow.inbox, 'approvals'], ['/compliance/requests', compliance.requests, 'requests'],
  ['/governance/profile', governance.profile, 'profile'], ['/governance/regulations', governance.regulations, 'regulations'],
  ['/governance/processes', governance.processes, 'processes'], ['/governance/committees', governance.committees, 'committees'],
  ['/policies', policies.list, 'policies'], ['/policies/new', policies.edit, 'policies'], ['/policies/:id', policies.view, 'policies'], ['/policies/:id/edit', policies.edit, 'policies'],
  ['/map', map.explorer, 'map'], ['/map/:id', map.explorer, 'map'],
  ['/frameworks', library.frameworks, 'frameworks'], ['/frameworks/:id', library.framework, 'frameworks'], ['/controls/:id', library.control, 'frameworks'],
  ['/workflow/chains', workflow.templates, 'chains'], ['/workflow/history', workflow.history, 'wfhistory'],
  ['/risk/assets', risk.assets, 'assets'], ['/risk/threats', risk.threats, 'threats'], ['/risk/vulnerabilities', risk.vulnerabilities, 'vulns'], ['/risk/mapping', risk.mapping, 'tmap'],
  ['/risk/register', risk.register, 'register'], ['/risk/assessments', risk.assessments, 'assessments'], ['/risk/assessments/:id', risk.assessment, 'assessments'],
  ['/compliance', compliance.overview, 'compliance'], ['/compliance/frameworks/:id', compliance.framework, 'compliance'],
  ['/compliance/gaps', compliance.gaps, 'gaps'], ['/compliance/gaps/:id', compliance.gap, 'gaps'],
  ['/audit/questions', audit.questions, 'questions'], ['/audit/audits', audit.audits, 'audits'], ['/audit/audits/:id', audit.audit, 'audits'], ['/audit/findings', audit.findings, 'findings'],
  ['/reports', reports.management, 'reports'],
  ['/admin/users', admin.users, 'users'], ['/admin/roles', admin.roles, 'roles'], ['/admin/departments', admin.departments, 'departments'], ['/admin/settings', admin.settings, 'settings'], ['/admin/activity', admin.activity, 'activity'],
  ['/platform/tenants', admin.tenants, 'tenants'], ['/platform/team', admin.team, 'team'], ['/platform/rules', admin.rules, 'rules'],
].map(([p, fn, key]) => { const keys = []; return { rx: new RegExp('^' + p.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'), keys, fn, key }; });

// Modules shown in the floating bar; each has the pages shown as pills inside the page header.
function modules() {
  const me = state.me; const m = [];
  if (me.tenant) {
    m.push({ label: 'Home', word: 'Overview', items: [['home', 'Overview', '#/'], ['approvals', 'Approvals', '#/approvals'], ['requests', 'Evidence requests', '#/compliance/requests']] });
    if (can('governance') || can('policies')) m.push({ label: 'Governance', word: 'Govern', items: [
      can('policies') && ['policies', 'Policies', '#/policies'], can('governance') && ['profile', 'Company profile', '#/governance/profile'], can('governance') && ['regulations', 'Laws and regulations', '#/governance/regulations'],
      can('governance') && ['processes', 'Business processes', '#/governance/processes'], can('governance') && ['committees', 'Committees', '#/governance/committees']] });
    if (can('risk')) m.push({ label: 'Risk', word: 'Risk', items: [['register', 'Register', '#/risk/register'], ['assessments', 'Assessments', '#/risk/assessments'], ['assets', 'Assets', '#/risk/assets'], ['threats', 'Threats', '#/risk/threats'],
      ['vulns', 'Vulnerabilities', '#/risk/vulnerabilities'], ['tmap', 'Threat mapping', '#/risk/mapping']] });
    if (can('compliance')) m.push({ label: 'Compliance', word: 'Comply', items: [['compliance', 'Position', '#/compliance'], ['gaps', 'Gap assessments', '#/compliance/gaps']] });
    if (can('audit')) m.push({ label: 'Audit', word: 'Audit', items: [['audits', 'Audits', '#/audit/audits'], ['questions', 'Question pool', '#/audit/questions'], ['findings', 'Findings', '#/audit/findings']] });
    if (can('frameworks')) m.push({ label: 'Control map', word: 'Connect', items: [['map', 'Explorer', '#/map'], ['frameworks', 'Frameworks', '#/frameworks']] });
    if (can('reports')) m.push({ label: 'Reports', word: 'Report', items: [['reports', 'Management report', '#/reports']] });
    if (can('admin') || can('workflow')) m.push({ label: 'Workspace', word: 'Manage', items: [can('admin') && ['users', 'People', '#/admin/users'], can('admin') && ['roles', 'Roles', '#/admin/roles'], can('admin') && ['departments', 'Departments', '#/admin/departments'],
      can('workflow') && ['chains', 'Approval chains', '#/workflow/chains'], can('workflow') && ['wfhistory', 'Approval history', '#/workflow/history'], can('admin') && ['settings', 'Settings', '#/admin/settings'], can('admin') && ['activity', 'Activity', '#/admin/activity']] });
  }
  if (me.user.is_platform_admin) m.push({ label: 'Platform', word: 'Platform', items: [['tenants', 'Organisations', '#/platform/tenants'], ['team', 'Platform team', '#/platform/team'], ['rules', 'Regulatory rules', '#/platform/rules']] });
  m.forEach(x => x.items = x.items.filter(Boolean));
  return m.filter(x => x.items.length);
}

let linksEl, heroSlot, bodySlot, inboxCount = 0;
function drawNav(activeKey) {
  const mods = modules(); const current = mods.find(m => m.items.some(i => i[0] === activeKey)) || mods[0];
  mount(clear(linksEl), mods.map(m => h('a', { href: m.items[0][2], class: m === current ? 'active' : '' }, m.label, m.label === 'Home' && inboxCount ? h('span.count', null, inboxCount) : null)));
  lens(linksEl, 'main');
  state.nav = current ? { module: current.label, word: current.word, sub: current.items.map(([key, label, href]) => ({ label, href, active: key === activeKey })) } : null;
}
function shell() {
  const me = state.me; const initials = me.user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  linksEl = h('div.nav-links'); heroSlot = h('div'); bodySlot = h('div'); state.heroSlot = heroSlot;
  const bell = me.tenant ? h('button.tool', { onclick: toggleNotifications, 'aria-label': 'Notifications' }, icon('bell', 18), me.unread ? h('span.dot', null, me.unread) : null) : null;
  mount(clear(app), h('header.nav-wrap.no-print', null, h('nav.glass-nav', { 'aria-label': 'Main' },
    h('a.brand', { href: me.tenant ? '#/' : '#/platform/tenants', 'aria-label': 'Cryptika GRC Hub' }, logo(30), h('span', null, 'Cryptika')), linksEl,
    h('div.nav-tools', null, accessChip(), bell, h('button.tool.who', { onclick: e => { e.stopPropagation(); toggleMenu(userMenu()); } }, h('span.avatar', null, initials), h('span', null, me.user.name.split(' ')[0])), h('div', { id: 'menu-slot' })))),
    h('main', { id: 'outlet' }, heroSlot, bodySlot));
  const bar = app.querySelector('.glass-nav'); onscroll = () => bar.isConnected && bar.classList.toggle('compact', scrollY > 80);   // the bar tightens once the page moves under it
}
// A restricted organisation says so in the bar on every page; the details open on request.
function accessChip() {
  const a = state.me.tenant?.access; if (!a || a.status === 'active') return null; const label = a.status === 'read_only' ? 'Read-only' : 'Suspended';
  const until = a.until ? `Until ${new Date(a.until).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Until the platform team lifts it';
  return h('button.tool.access', { title: `${label} — ${until}`, onclick: e => { e.stopPropagation(); toggleMenu(h('div.menu', null, h('div.item', null, h('b', null, `${state.me.tenant.name} is ${label.toLowerCase()}`),
    h('div.small', { style: 'margin-top:4px' }, a.status === 'read_only' ? 'Everything can be read. Nothing can be changed for now.' : 'Only the platform team can open this workspace.'), h('div.muted.small', { style: 'margin-top:8px' }, until), a.reason ? h('div.muted.small', null, a.reason) : null))); } }, h('i'), h('span', null, label));
}
function toggleMenu(menu) { const slot = document.getElementById('menu-slot'); if (slot.firstChild) return clear(slot); mount(clear(slot), menu); setTimeout(() => document.addEventListener('click', () => clear(slot), { once: true }), 0); }
function userMenu() {
  const me = state.me;
  return h('div.menu', { style: 'min-width:250px' }, h('div.item', null, h('b', null, me.user.name), h('div.muted.small', null, me.user.role), me.tenant ? h('div.muted.small', null, me.tenant.name) : null),
    me.user.is_platform_admin && me.tenant ? h('a.item', { onclick: () => switchTenant(null) }, 'Leave this organisation') : null,
    h('a.item', { onclick: changePassword }, 'Change password'), h('a.item', { onclick: async () => { await api.post('/auth/logout'); state.me = null; location.hash = '#/login'; route(); } }, 'Sign out'));
}
function changePassword() {
  formModal({ title: 'Change password', submitLabel: 'Save password', fields: [{ name: 'current', label: 'Current password', type: 'password', required: true, full: true }, { name: 'next', label: 'New password', type: 'password', required: true, full: true, hint: 'At least 10 characters' }],
    onSubmit: async d => { await api.post('/me/password', d); toast('Password changed', 'ok'); } });
}
async function toggleNotifications(e) {
  e.stopPropagation(); const list = await api.get('/notifications');
  toggleMenu(h('div.menu', null, list.length ? [h('a.item.small', { onclick: async () => { await api.post('/notifications/read', {}); await boot(false); } }, 'Mark all as read'),
    ...list.map(n => h('a.item', { class: n.is_read ? '' : 'unread', href: n.link || '#/', onclick: () => api.post('/notifications/read', { id: n.id }) }, h('b', null, n.title), h('div.small', null, n.body || ''), h('div.muted.small', null, fmtDateTime(n.at))))]
    : h('div.empty', null, 'You are all caught up')));
}
export async function switchTenant(id) { if (await attempt(() => api.post('/platform/switch', { tenant_id: id }))) { await boot(false); location.hash = id ? '#/' : '#/platform/tenants'; route(); } }

function login() {
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'name@organisation.com' }); const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const submit = async e => { e.preventDefault(); if (await attempt(() => api.post('/auth/login', { email: email.value, password: pw.value }))) { await boot(false); location.hash = state.me.tenant ? '#/' : '#/platform/tenants'; route(); } };
  const go = btn('Sign in', null, 'primary'); go.type = 'submit'; go.style.cssText = 'justify-content:space-between;width:100%;padding:7px 7px 7px 24px;font-size:15px';
  mount(clear(app), h('div.login', null,
    h('div.art', null, h('div.aurora', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('div.brand', { style: 'padding:0;font-size:19px;gap:13px' }, logo(44), h('span', null, 'Cryptika')),
      h('div.rise', null, h('h1', null, 'Comply once. Prove it everywhere.'), h('p', null, 'One control satisfied, every equivalent framework updated.')),
      h('div.label', { style: 'color:rgba(255,255,255,.4)' }, 'Governance · Risk · Compliance · Audit')),
    h('form.form', { onsubmit: submit }, h('div.box.stack.loose.rise.d1', null, h('div', null, h('div.label', null, 'GRC Hub'), h('h2', { style: 'margin-top:10px' }, 'Welcome back')),
      h('div.stack', null, h('label.field', null, 'Email', email), h('label.field', null, 'Password', pw)), go))));
  email.focus();
}

async function boot(draw = true) {
  try { state.me = await api.get('/me'); } catch { state.me = null; }
  if (state.me?.tenant) { state.lookups = await api.get('/lookups'); try { inboxCount = (await api.get('/workflow/inbox')).length; } catch { inboxCount = 0; } } else { state.lookups = null; inboxCount = 0; }
  if (state.me) shell();
  if (draw) route();
}
export async function refreshLookups() { state.lookups = await api.get('/lookups'); }

let cleanup = null;
// Pages change with a soft glass dissolve where the browser supports it; the content is always drawn, with or without the effect.
function route() {
  if (!state.me || !document.startViewTransition || calm()) return render();
  return new Promise(done => { let p; const t = document.startViewTransition(() => (p = render())); t.ready.catch(() => {}); t.finished.catch(() => {}).then(() => p).then(done, done); });
}
async function render() {
  if (!state.me) return login();
  let path = location.hash.replace(/^#/, '') || '/';
  path = path.split('?')[0]; if (path === '/login') path = '/';
  if (!state.me.tenant && !path.startsWith('/platform')) path = '/platform/tenants';
  if (cleanup) { cleanup(); cleanup = null; }
  for (const r of ROUTES) {
    const m = r.rx.exec(path); if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    drawNav(r.key); clear(heroSlot); state.heroKey = '';
    const view = h('div.page-body.enter'); bodySlot.replaceChildren(view); window.scrollTo(0, 0);
    try { const end = await r.fn(view, params); if (typeof end === 'function') cleanup = end; if (!view.childNodes.length) view.remove(); }
    catch (e) { mount(clear(view), h('div.note.bad', { style: 'margin-top:120px' }, e.message)); }
    setTimeout(() => view.classList.remove('enter'), 1500);   // entrance effects play once, not on every later refresh
    return;
  }
  clear(heroSlot); bodySlot.replaceChildren(h('div.page-body', null, h('div.empty', { style: 'margin-top:120px' }, h('b', null, 'This page does not exist'), h('a', { href: '#/' }, 'Back to the overview'))));
}
window.addEventListener('hashchange', route);
export const reload = route;
boot();
