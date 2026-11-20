// Shared interface helpers. All text is inserted as text nodes, never as HTML.
export const state = { me: null, lookups: null, nav: null, heroSlot: null, heroKey: '' };

export function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = el => { el.replaceChildren(); return el; };
// Appends children, skipping empty values and flattening lists (native append would print them as text).
export const mount = (el, ...kids) => { add(el, kids); return el; };

// ── Motion ──
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// A figure that counts up to its value. Accepts 42, '42%', '≤ 12' or '3 / 9'; the first number moves and the final text is always exact.
export function tick(value, ms = 1100) {
  const text = String(value); const m = /\d+(?:\.\d+)?/.exec(text); const el = h('span.tick', null, text);
  if (!m || !Number(m[0]) || calm()) return el;
  const target = Number(m[0]); const dec = (m[0].split('.')[1] || '').length; const pre = text.slice(0, m.index); const post = text.slice(m.index + m[0].length);
  el.textContent = pre + (0).toFixed(dec) + post; const t0 = performance.now();
  const step = now => { const p = Math.min(1, (now - t0) / ms); if (p >= 1) { el.textContent = text; return; } el.textContent = pre + (target * (1 - Math.pow(1 - p, 4))).toFixed(dec) + post; requestAnimationFrame(step); };
  requestAnimationFrame(step); return el;
}
// The sliding glass lens behind the current item of a pill bar. It glides from where it last was, and a second, lighter lens follows the pointer.
const lensAt = new Map();
export function lens(box, key) {
  const current = () => box.querySelector(':scope > .active, :scope > .on');
  const make = cls => { let l = box.querySelector(':scope > .' + cls); if (!l) { l = h('i', { class: cls, 'aria-hidden': 'true' }); box.prepend(l); } return l; };
  const solid = make('lens'); const ghost = make('lens-ghost');
  const put = (l, el, animate) => { if (!el) { l.style.opacity = 0; return; } l.style.transition = animate ? '' : 'none'; l.style.width = el.offsetWidth + 'px'; l.style.height = el.offsetHeight + 'px'; l.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`; l.style.opacity = 1; };
  const active = current(); const prev = lensAt.get(key);
  if (active && prev && !calm() && (prev.x !== active.offsetLeft || prev.w !== active.offsetWidth)) {
    Object.assign(solid.style, { transition: 'none', opacity: 1, width: prev.w + 'px', height: prev.h + 'px', transform: `translate(${prev.x}px, ${prev.y}px)` }); void solid.offsetWidth;
    box.classList.add('moving'); setTimeout(() => box.classList.remove('moving'), 560);
    requestAnimationFrame(() => put(solid, active, true));
  } else put(solid, active, false);
  if (active) lensAt.set(key, { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight });
  document.fonts?.ready.then(() => { const a = current(); if (a && box.isConnected) { put(solid, a, false); lensAt.set(key, { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight }); } });
  box.onpointerover = e => { const a = e.target.closest('a, button'); if (a && a.parentNode === box && a !== current()) put(ghost, a, ghost.style.opacity === '1'); else if (a === current()) ghost.style.opacity = 0; };
  box.onpointerleave = () => { ghost.style.opacity = 0; };
}
// Glass surfaces carry a highlight that follows the pointer.
addEventListener('pointermove', e => { const g = e.target.closest?.('.glass, .glass-nav, .subnav, .card.lift, .hero .btn'); if (!g) return; const r = g.getBoundingClientRect(); g.style.setProperty('--mx', `${e.clientX - r.left}px`); g.style.setProperty('--my', `${e.clientY - r.top}px`); }, { passive: true });

// The Cryptika mark: a cut amethyst shaped as a C, holding an emerald. Static drawing, no data.
const GEM = `<svg viewBox="0 0 48 48" aria-hidden="true"><defs>
<linearGradient id="gem-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="gem-mint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9f8dd"/><stop offset="1" stop-color="#10b981"/></linearGradient>
<clipPath id="gem-cut"><path d="M24 2 43.05 13 32.66 19 24 14 15.34 19v10L24 34l8.66-5 10.39 6L24 46 4.95 35V13z"/></clipPath></defs>
<g clip-path="url(#gem-cut)"><path d="M4.95 13 24 2v12l-8.66 5z" fill="#f3ecff"/><path d="M24 2 43.05 13 32.66 19 24 14z" fill="#cdb6ff"/><path d="M4.95 13 15.34 19v10L4.95 35z" fill="#a78bfa"/>
<path d="M4.95 35 15.34 29 24 34v12z" fill="#7e52d6"/><path d="M24 46V34l8.66-5 10.39 6z" fill="#5b2aa3"/><g transform="rotate(22 24 24)"><rect class="gem-sheen" x="-26" y="-14" width="15" height="76" fill="url(#gem-sheen)"/></g></g>
<path d="M24 2v12M4.95 13l10.39 6M4.95 35l10.39-6M24 46V34" stroke="#fff" stroke-opacity=".5" stroke-width=".6" fill="none"/>
<g class="gem-spark"><path d="M38.5 18.2 42.5 24l-4 5.8-4-5.8z" fill="url(#gem-mint)"/><path d="M38.5 18.2v11.6M34.5 24h8" stroke="#fff" stroke-opacity=".55" stroke-width=".5"/></g></svg>`;
export function logo(size = 30) { const el = h('span.gem', { style: `width:${size}px;height:${size}px` }); el.innerHTML = GEM; return el; }

// ── API ──
async function call(method, url, body, raw) {
  const res = await fetch('/api' + url, {
    method, credentials: 'same-origin',
    headers: { 'X-GRC-Client': '1', ...(raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && !url.startsWith('/auth') && url !== '/me') { location.hash = '#/login'; throw new Error('Please sign in'); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export const api = {
  get: u => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), put: (u, b) => call('PUT', u, b ?? {}), del: u => call('DELETE', u),
  upload: (u, file) => call('POST', u, undefined, file),
};
// Runs an action and shows the outcome; returns undefined when it failed.
export async function attempt(fn, done) {
  try { const r = await fn(); if (done) toast(done, 'ok'); return r ?? true; } catch (e) { toast(e.message, 'bad'); return undefined; }
}

// ── Feedback ──
export function toast(msg, kind = '') {
  let box = document.querySelector('.toasts'); if (!box) { box = h('div.toasts', { role: 'status' }); document.body.append(box); }
  const t = h('div.toast', { class: kind }, msg); box.append(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), calm() ? 0 : 260); }, kind === 'bad' ? 6500 : 3200);
}
export function modal({ title, body, actions = [], wide = false }) {
  const close = () => { document.removeEventListener('keydown', esc); if (calm()) return ov.remove(); ov.classList.add('closing'); setTimeout(() => ov.remove(), 220); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const foot = h('footer', null, actions.map(a => btn(a.label, () => a.onclick(close), a.kind || '')));
  const ov = h('div.overlay', { onmousedown: e => { if (e.target === ov) close(); } },
    h('div.modal', { class: wide ? 'wide' : '', role: 'dialog', 'aria-modal': 'true' },
      h('header', null, h('h2', null, title), h('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, icon('x'))),
      h('div.body', null, body), actions.length ? foot : null));
  document.body.append(ov); document.addEventListener('keydown', esc);
  setTimeout(() => ov.querySelector('input:not([type=hidden]), textarea, select')?.focus(), 30);
  return close;
}
export function confirmBox(message, label = 'Confirm', kind = 'primary') {
  return new Promise(resolve => modal({ title: 'Please confirm', body: h('p', null, message),
    actions: [{ label: 'Cancel', onclick: c => { c(); resolve(false); } }, { label, kind, onclick: c => { c(); resolve(true); } }] }));
}

// ── Forms ──
// fields: [{ name, label, type, options:[{value,label}]|[string], required, hint, full, placeholder, rows }]
export function buildForm(fields, values = {}) {
  const inputs = {};
  const grid = h('div.form-grid', null, fields.map(f => {
    let input; const v = values[f.name];
    if (f.type === 'select') {
      input = h('select', null, f.required ? null : h('option', { value: '' }, f.placeholder || '—'),
        (f.options || []).map(o => { const val = typeof o === 'object' ? o.value : o; return h('option', { value: val, selected: String(val) === String(v ?? '') }, typeof o === 'object' ? o.label : o); }));
    } else if (f.type === 'textarea') input = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder }, v ?? '');
    else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: !!v });
    else input = h('input', { type: f.type || 'text', value: v ?? '', placeholder: f.placeholder, min: f.min, max: f.max, step: f.step });
    inputs[f.name] = input;
    if (f.type === 'checkbox') return h('label.field.check', { class: f.full ? 'full' : '' }, input, f.label);
    return h('label.field', { class: f.full || f.type === 'textarea' ? 'full' : '' }, f.label + (f.required ? ' *' : ''), input, f.hint ? h('span.hint', null, f.hint) : null);
  }));
  const read = () => Object.fromEntries(fields.map(f => {
    const i = inputs[f.name]; let v = f.type === 'checkbox' ? i.checked : i.value;
    if (f.type === 'number' && v !== '') v = Number(v);
    return [f.name, v];
  }));
  return { el: grid, read, inputs };
}
export function formModal({ title, fields, values, submitLabel = 'Save', onSubmit, wide, intro }) {
  const form = buildForm(fields, values);
  return modal({ title, wide, body: h('div.stack', null, intro ? h('p.muted', null, intro) : null, form.el), actions: [
    { label: 'Cancel', onclick: c => c() },
    { label: submitLabel, kind: 'primary', onclick: async close => {
      const data = form.read();
      for (const f of fields) if (f.required && (data[f.name] === '' || data[f.name] == null)) return toast(`${f.label} is required`, 'bad');
      if (await attempt(() => onSubmit(data))) close();
    } }] });
}
// Reads a text file chosen by the user (CSV imports)
export function pickFile(accept, cb, asBinary) {
  // The input stays in the document until a file is chosen: a detached input can be discarded by the browser before it reports back.
  document.getElementById('file-pick')?.remove();
  const i = h('input', { type: 'file', id: 'file-pick', accept, style: 'position:fixed;left:-9999px', onchange: async () => { const f = i.files[0]; i.remove(); if (f) cb(asBinary ? f : await f.text(), f); } });
  document.body.append(i); i.click();
}

// ── Display ──
const TONE = { published: 'ok', approved: 'ok', valid: 'ok', registered: 'ok', completed: 'ok', verified: 'ok', closed: 'ok', resolved: 'ok', yes: 'ok', active: 'ok', done: 'info',
  in_review: 'plum', in_progress: 'plum', submitted: 'plum', requested: 'info', planned: 'info', fieldwork: 'plum', reporting: 'plum', pending: 'warn', draft: '', unassigned: '', open: 'warn',
  rejected: 'bad', invalid: 'bad', no: 'bad', suspended: 'bad', partial: 'warn', retired: '', not_applicable: '', mandatory: 'solid', voluntary: 'plum', recommended: 'info',
  Critical: 'bad', High: 'warn', Medium: 'info', Low: '', Direct: 'ok', Partial: 'warn', Tenant: 'plum', Standalone: '', Reference: '' };
const LABEL = { in_review: 'In review', in_progress: 'In progress', not_applicable: 'Not applicable', unassigned: 'Not assigned', requested: 'Evidence requested', submitted: 'Evidence submitted',
  valid: 'Valid', invalid: 'Returned', Tenant: 'Own mapping', na: 'N/A' };
export const nice = s => LABEL[s] || (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' ') : '—');
export const badge = (text, tone) => h('span.badge', { class: tone ?? TONE[text] ?? '' }, nice(text));
export const fmtDate = s => s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = s => s ? new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const can = (module, level = 'view') => ({ none: 0, view: 1, edit: 2, manage: 3 })[state.me.permissions[module] || 'none'] >= ({ view: 1, edit: 2, manage: 3 })[level];

// Long lists open with the first rows and grow on request, so a thousand records stay quick to read.
export function table({ columns, rows, onRow, empty = 'Nothing here yet', emptyHint, page = 100 }) {
  if (!rows.length) return h('div.table-wrap', null, h('div.empty', null, h('b', null, empty), emptyHint || ''));
  const row = (r, i) => h('tr', { class: onRow ? 'click' : '', style: i < 16 ? `--i:${i}` : null, onclick: onRow ? e => { if (!e.target.closest('button, a, input, select, textarea')) onRow(r); } : null },
    columns.map(c => h('td', { class: (c.align || '') + (c.cls ? ' ' + c.cls : '') }, c.render ? c.render(r) : (r[c.key] ?? '—'))));
  const body = h('tbody', null, rows.slice(0, page).map(row)); let shown = Math.min(page, rows.length);
  const more = h('div.more'); const drawMore = () => { clear(more); const left = rows.length - shown; if (left <= 0) return more.remove();
    mount(more, h('span.muted', null, `Showing ${shown} of ${rows.length}`), btn(`Show ${Math.min(page, left)} more`, () => { mount(body, rows.slice(shown, shown + page).map(r => row(r, 99))); shown = Math.min(rows.length, shown + page); drawMore(); }, 'sm'),
      left > page ? btn('Show all', () => { mount(body, rows.slice(shown).map(r => row(r, 99))); shown = rows.length; drawMore(); }, 'sm') : null); };
  drawMore();
  return h('div.table-wrap', null, h('table.data', null,
    h('thead', null, h('tr', null, columns.map(c => h('th', { class: c.align || '', style: c.width ? `width:${c.width}` : null }, c.label)))), body), rows.length > page ? more : null);
}
// ── Icons (24px stroke set) ──
const ICONS = {
  arrow: 'M7 17 17 7M8 7h9v9', plus: 'M12 5v14M5 12h14', check: 'm5 12.5 4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6 6 18', download: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  print: 'M7 9V4h10v5M7 17H5v-6h14v6h-2M8 14h8v6H8z', bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20h4', search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm9 2-4-4',
  minus: 'M5 12h14', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  expand: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18', back: 'M15 6l-6 6 6 6', send: 'M5 12h13M13 6l6 6-6 6',
};
export function icon(name, size = 16) {
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', ICONS[name] || ICONS.arrow); svg.append(path); return svg;
}
const iconFor = label => /^(add|new|write|start|register|attach)/i.test(label) ? 'plus' : /^(save|approve|accept|use|confirm|submit|close|mark|verify)/i.test(label) ? 'check'
  : /^print/i.test(label) ? 'print' : /^(export|import)/i.test(label) ? 'download' : /^(send|sign in)/i.test(label) ? 'send' : 'arrow';
// Buttons are pills; the main action of a view carries a round icon.
export const btn = (label, onclick, kind = '') => h('button.btn', { class: kind, onclick, type: 'button' }, h('span', null, label),
  /\bprimary\b/.test(kind) && !/\bsm\b/.test(kind) ? h('span.ic', null, icon(iconFor(label), 15)) : null);

// The dark header of a page. It lives in its own slot above the page body, so pages simply call pageHead() first.
// opts: { stats: [{ v, l }], side: Node, tall: boolean }
export function pageHead(title, subtitle, actions, crumb, opts = {}) {
  const nav = state.nav || {}; const slot = state.heroSlot; if (!slot) return null;
  const key = `${location.hash}|${title}`; const same = state.heroKey === key; state.heroKey = key;
  const side = opts.side || (opts.stats ? opts.stats.filter(Boolean).map(st => h('div.glass.glass-stat', null, h('div.v', null, same ? String(st.v) : tick(st.v), st.unit ? h('small', null, st.unit) : null), h('div.l', null, st.l))) : null);
  const sub = nav.sub && nav.sub.length > 1 ? h('nav.subnav.no-print', { 'aria-label': nav.module }, nav.sub.map(i => h('a', { href: i.href, class: i.active ? 'active' : '' }, i.label))) : null;
  const hero = h('section.hero', { class: opts.tall ? 'tall' : '', 'data-word': nav.word || '' }, h('div.aurora', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('div.hero-inner', null,
    h('div.hero-text', { style: same ? 'animation:none' : null },
      h('div.label', null, crumb ? [nav.module, ' / ', crumb] : nav.module),
      h('h1', null, title), subtitle ? h('p.sub', null, subtitle) : null,
      actions ? h('div.hero-actions.no-print', null, [actions].flat(Infinity).filter(Boolean).sort((a, b) => (b.classList?.contains('primary') ? 1 : 0) - (a.classList?.contains('primary') ? 1 : 0))) : null,
      sub),
    side ? h('div.hero-side', { style: same ? 'animation:none' : null }, side) : null));
  slot.replaceChildren(hero); if (sub) lens(sub, 'sub:' + nav.module);
  return null;
}
// Replaces the header slot with a full-bleed element (used by the control map).
export function setHero(el) { state.heroKey = ''; state.heroSlot?.replaceChildren(el); }
export const sectionHead = (title, text, right) => h('div.section-head', null, h('div', null, h('h2', null, title), text ? h('p.muted', null, text) : null), right || null);
let tabSeq = 0;
export function tabs(defs, initial) {
  const body = h('div'); const bar = h('div.tabs.no-print'); const key = 'tabs:' + (++tabSeq); requestAnimationFrame(() => bar.isConnected && lens(bar, key));
  const show = key => { [...bar.children].forEach(b => b.classList.toggle('on', b.dataset.k === key)); if (bar.isConnected) lens(bar, key); clear(body); const r = defs.find(d => d.key === key).render(body); if (r instanceof Node) body.append(r); };
  defs.forEach(d => bar.append(h('button', { 'data-k': d.key, onclick: () => show(d.key) }, d.label)));
  show(initial || defs[0].key);
  return h('div', null, bar, body);
}

// Coverage: own evidence · inherited (direct mapping) · inherited (partial mapping) · gap
export function covBar(dim, applicable, tall) {
  const w = n => `width:${applicable ? (n / applicable) * 100 : 0}%`;
  return h('div.cov', { class: tall ? 'tall' : '', title: `${dim.direct} own · ${dim.inherited} inherited · ${dim.inherited_partial} inherited (partial) · ${dim.gap} gap` },
    h('i.direct', { style: w(dim.direct) }), h('i.inherited', { style: w(dim.inherited) }), h('i.partial', { style: w(dim.inherited_partial) }));
}
export const covLegend = () => h('div.legend', null, h('span.direct', null, 'Own evidence'), h('span.inherited', null, 'Inherited through the control map'),
  h('span.partial', null, 'Inherited, partial mapping'), h('span', null, 'Gap'));
const STATE_TEXT = { direct: 'Met', inherited: 'Inherited', inherited_partial: 'Inherited (partial)', gap: 'Gap' };
export const stateTag = s => h('span.state', { class: s }, STATE_TEXT[s]);
export const controlChip = (c, onRemove) => h('span.chip', { title: c.title || '' }, h('span.fw', null, c.framework), h('a', { href: `#/controls/${c.id}` }, c.ref), onRemove ? h('button', { onclick: onRemove, 'aria-label': 'Remove' }, '×') : null);
export const scoreTag = (v, lvl) => v == null ? h('span.muted', null, '—') : h('span.score', { class: 'lv-' + lvl }, String(v));

// Control picker: search any framework the organisation can see and pick one or more controls.
export function controlPicker({ title = 'Choose controls', frameworkId, adoptedOnly = false, multiple = true, onDone }) {
  const picked = new Map(); const list = h('div.picker-list'); const sel = h('div');
  const fw = h('select', null, h('option', { value: '' }, adoptedOnly ? 'All adopted frameworks' : 'All frameworks'),
    state.lookups.frameworks.filter(f => !adoptedOnly || f.adopted).map(f => h('option', { value: f.id, selected: f.id === frameworkId }, f.code)));
  const q = h('input', { type: 'search', placeholder: 'Search by ID or words — A.5.10, backup' });
  const drawSel = () => clear(sel).append(...[...picked.values()].map(c => controlChip(c, () => { picked.delete(c.id); drawSel(); load(); })));
  let timer; const load = async () => {
    const rows = await api.get(`/controls/search?q=${encodeURIComponent(q.value)}&framework_id=${fw.value}${adoptedOnly ? '&adopted=1' : ''}`);
    clear(list); if (!rows.length) list.append(h('div.empty', null, 'Nothing matches'));
    rows.forEach(c => list.append(h('div.opt', { class: picked.has(c.id) ? 'sel' : '', onclick: () => {
      if (!multiple) { close(); return onDone([c]); }
      picked.has(c.id) ? picked.delete(c.id) : picked.set(c.id, c); drawSel(); load();
    } }, h('div', null, h('b', null, c.ref), ' ', h('span.muted.small', null, c.framework)), h('div.small', null, c.title || cleanText(c.description).slice(0, 140)))));
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 220); }); fw.addEventListener('change', load);
  const close = modal({ title, wide: true, body: h('div.stack', null, h('div.row', null, h('div', { style: 'width:240px' }, fw), h('div.grow', null, q)), list, multiple ? sel : null),
    actions: multiple ? [{ label: 'Cancel', onclick: c => c() }, { label: 'Use selected controls', kind: 'primary', onclick: c => { c(); onDone([...picked.values()]); } }] : [] });
  load();
}

// Approval track + history for any record that went through the workflow engine
export function workflowPanel(wf, onChange) {
  if (!wf) return null;
  const closed = wf.status !== 'in_progress';
  const track = h('div.track', null, wf.stages.map((s, i) => h('div.step', { class: wf.status === 'rejected' && i === wf.stage_index ? 'rejected' : i < wf.stage_index || wf.status === 'approved' ? 'done' : (!closed && i === wf.stage_index ? 'now' : '') },
    h('b', null, s.name), s.role_name)));
  const mine = !closed && (wf.current.role_id === state.me.user.role_id || can('admin', 'manage'));
  const comment = h('textarea', { rows: 2, placeholder: 'Comment (required when returning)' });
  const act = async action => { if (await attempt(() => api.post(`/workflow/instances/${wf.id}/act`, { action, comment: comment.value }), action === 'approve' ? 'Approved' : 'Returned to the author')) onChange?.(); };
  return h('div.card', null, h('header', null, h('h3', null, wf.template_name), badge(wf.status)),
    h('div.body.stack', null, track,
      mine ? h('div.stack.tight.no-print', null, wf.current.role_id !== state.me.user.role_id ? h('div.note.warn', null, `This step belongs to ${wf.current.role_name}. Deciding for them is recorded.`) : null,
        comment, h('div.row', null, btn('Approve', () => act('approve'), 'ok'), btn('Return to author', () => act('reject'), 'danger'))) : null,
      h('ul.timeline', null, wf.history.map(x => h('li', null, h('b', null, x.action === 'submit' ? 'Submitted' : `${x.stage_name}: ${x.action === 'approve' ? 'approved' : 'returned'}`),
        ` — ${x.user_name || 'System'}, ${fmtDateTime(x.at)}`, x.comment ? h('div.muted', null, x.comment) : null)))));
}

// Evidence files attached to a record
export function evidencePanel(entityType, entityId, canAdd, onChange) {
  const box = h('div.stack.tight');
  const load = async () => {
    const files = await api.get(`/evidence?entity_type=${entityType}&entity_id=${entityId}`);
    clear(box).append(...files.map(f => h('div.row', null, h('a', { href: `/api/evidence/${f.id}/download` }, f.filename), h('span.muted.small', null, `v${f.version} · ${Math.max(1, Math.round(f.size / 1024))} KB · ${f.uploaded_by || ''} · ${fmtDate(f.uploaded_at)}`),
      canAdd ? h('button.btn.link.small', { onclick: async () => { if (await attempt(() => api.del('/evidence/' + f.id))) { load(); onChange?.(); } } }, 'Remove') : null)));
    if (!files.length) box.append(h('span.muted.small', null, 'No files attached'));
    if (canAdd) box.append(h('div', null, btn('Attach a file', () => pickFile('', async (file) => {
      if (await attempt(() => api.upload(`/evidence?entity_type=${entityType}&entity_id=${entityId}&filename=${encodeURIComponent(file.name)}`, file), 'File attached')) { load(); onChange?.(); } }, true), 'sm')));
  };
  load(); return box;
}
// Source texts carry provenance markers that are not meant for readers; they are hidden on screen, never changed in the data.
export const cleanText = s => String(s || '').replace(/^\[Cryptika-authored[^\]]*\]\s*/, '').replace(/^Cryptika summary:\s*/, '');
export const opt = (rows, label = 'name') => rows.map(r => ({ value: r.id, label: r[label] }));
export const download = url => { const a = h('a', { href: '/api' + url }); document.body.append(a); a.click(); a.remove(); };
