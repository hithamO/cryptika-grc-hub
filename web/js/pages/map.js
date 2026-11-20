// Control map explorer: a living web of frameworks, controls and the organisation's own records.
// Zoom out to see how frameworks hang together; zoom in on one control and pull out every rope tied to it.
import { h, mount, clear, api, state, setHero, btn, icon, can, attempt, toast, confirmBox, cleanText } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
const REGION = { International: '#a78bfa', 'Saudi Arabia': '#34d399', Jordan: '#fbbf24', UAE: '#60a5fa', 'European Union': '#f472b6', 'Own framework': '#f4f4f5' };
const RECORD = { policy: ['#ffffff', 'Policy'], risk: ['#fca5a5', 'Risk'], evidence: ['#5eead4', 'Evidence'], question: ['#fde68a', 'Audit question'] };
const STATE_TEXT = { direct: 'Met', inherited: 'Inherited', inherited_partial: 'Inherited (partial)', gap: 'Gap' };
const MAX_NODES = 320;
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const colorOf = region => REGION[region] || '#d4d4d8';

// ── The web: nodes joined by ropes, laid out by a small physics simulation ──
class Web {
  constructor(svg, handlers) {
    this.svg = svg; this.on = handlers; this.nodes = new Map(); this.edges = []; this.view = { x: 0, y: 0, k: 1 }; this.alpha = 0; this.raf = 0; this.selected = null; this.connectFrom = null; this.charge = 46; this.spring = 0.035;
    this.vp = el('g'); this.ropeLayer = el('g'); this.nodeLayer = el('g'); this.live = el('path', { class: 'rope live', d: '' }); this.live.style.display = 'none';
    this.vp.append(this.ropeLayer, this.live, this.nodeLayer); svg.append(this.vp);
    this.bind(); this.center();
  }
  center() { const r = this.svg.getBoundingClientRect(); this.view = { x: r.width / 2, y: r.height / 2 + 20, k: 1 }; this.applyView(); }
  applyView() { const v = this.view; this.vp.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`); this.svg.classList.toggle('far', v.k < 0.55); this.svg.classList.toggle('near', v.k > 1.45); }
  reset() { this.nodes.clear(); this.edges = []; this.ropeLayer.replaceChildren(); this.nodeLayer.replaceChildren(); this.selected = null; this.cancelConnect(); }
  addNode(n) {
    if (this.nodes.has(n.key)) return this.nodes.get(n.key);
    const g = el('g', { class: `node ${n.kind}` }); let shape;
    if (n.kind === 'record') shape = el('rect', { x: -n.r, y: -n.r, width: n.r * 2, height: n.r * 2, rx: 4, fill: n.color });
    else { shape = el('circle', { r: n.r, fill: n.color, 'fill-opacity': n.kind === 'fw' ? 0.9 : 1 }); if (n.ring) { shape.setAttribute('stroke', '#34d399'); shape.setAttribute('stroke-width', 3); shape.style.stroke = '#34d399'; } }
    const t1 = el('text', { 'text-anchor': 'middle', y: n.r + 14 }); t1.textContent = n.label; g.append(shape, t1);
    if (n.sub) { const t2 = el('text', { class: 't2', 'text-anchor': 'middle', y: n.r + 26 }); t2.textContent = n.sub; g.append(t2); }
    g.addEventListener('pointerenter', () => this.hover(n.key)); g.addEventListener('pointerleave', () => this.hover(null));
    Object.assign(n, { vx: 0, vy: 0, el: g, x: n.x ?? (Math.random() - 0.5) * 60, y: n.y ?? (Math.random() - 0.5) * 60 });
    g.dataset.key = n.key; this.nodeLayer.append(g); this.nodes.set(n.key, n); return n;
  }
  addEdge(a, b, cls = '', len = 130, width) {
    if (a === b || !this.nodes.has(a) || !this.nodes.has(b)) return;
    if (this.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
    const path = el('path', { class: `rope ${cls}` }); if (width) path.style.strokeWidth = width;
    this.ropeLayer.append(path); this.edges.push({ a, b, len, el: path, bend: (this.edges.length % 2 ? 1 : -1) * (0.08 + Math.random() * 0.08) });
  }
  removeEdge(a, b) { const i = this.edges.findIndex(e => (e.a === a && e.b === b) || (e.a === b && e.b === a)); if (i >= 0) { this.edges[i].el.remove(); this.edges.splice(i, 1); } }
  degree(key) { return this.edges.filter(e => e.a === key || e.b === key).length; }
  heat(a = 1) { this.alpha = Math.max(this.alpha, a); if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); }
  tick() {
    this.raf = 0; const ns = [...this.nodes.values()]; const a = this.alpha;
    for (let i = 0; i < ns.length; i++) { const p = ns[i];
      for (let j = i + 1; j < ns.length; j++) { const q = ns[j]; let dx = p.x - q.x, dy = p.y - q.y; let d2 = dx * dx + dy * dy; if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 250000) continue; const f = ((p.r + q.r) * this.charge) / d2 * a; const d = Math.sqrt(d2); dx /= d; dy /= d; p.vx += dx * f; p.vy += dy * f; q.vx -= dx * f; q.vy -= dy * f; }
      if (p.tx != null) { p.vx += (p.tx - p.x) * 0.03 * a; p.vy += (p.ty - p.y) * 0.03 * a; } else { p.vx -= p.x * 0.0016 * a; p.vy -= p.y * 0.0016 * a; } }
    for (const e of this.edges) { const p = this.nodes.get(e.a), q = this.nodes.get(e.b); const dx = q.x - p.x, dy = q.y - p.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - e.len) * this.spring * a; const ux = dx / d, uy = dy / d;
      p.vx += ux * f; p.vy += uy * f; q.vx -= ux * f; q.vy -= uy * f; }
    for (const n of ns) { if (n.held) { n.vx = n.vy = 0; continue; } n.vx *= 0.8; n.vy *= 0.8; n.x += Math.max(-30, Math.min(30, n.vx)); n.y += Math.max(-30, Math.min(30, n.vy)); }
    this.draw(); this.alpha *= 0.985;
    if (this.alpha > 0.012 || this.dragging) this.raf = requestAnimationFrame(() => this.tick());
  }
  ropePath(p, q, bend) { const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2; const dx = q.x - p.x, dy = q.y - p.y; return `M${p.x.toFixed(1)},${p.y.toFixed(1)} Q${(mx - dy * bend).toFixed(1)},${(my + dx * bend).toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`; }
  draw() {
    for (const n of this.nodes.values()) n.el.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    for (const e of this.edges) e.el.setAttribute('d', this.ropePath(this.nodes.get(e.a), this.nodes.get(e.b), e.bend));
  }
  hover(key) {
    if (this.dragging) return; const k = key; const fade = !!key;   // ropes light up, and the rest fades, only while pointing at something
    const near = new Set([k]); for (const e of this.edges) { const hit = k && (e.a === k || e.b === k); e.el.classList.toggle('hot', !!hit); e.el.classList.toggle('dim', fade && !hit); if (hit) { near.add(e.a); near.add(e.b); } }
    for (const n of this.nodes.values()) n.el.classList.toggle('dim', fade && !near.has(n.key));
  }
  select(key) { this.selected = key; for (const n of this.nodes.values()) n.el.classList.toggle('sel', n.key === key); this.hover(null); }
  toWorld(ev) { const r = this.svg.getBoundingClientRect(); return { x: (ev.clientX - r.left - this.view.x) / this.view.k, y: (ev.clientY - r.top - this.view.y) / this.view.k }; }
  zoom(factor, cx, cy) { const r = this.svg.getBoundingClientRect(); cx ??= r.width / 2; cy ??= r.height / 2; const v = this.view; const k = Math.max(0.12, Math.min(4, v.k * factor)); v.x = cx - (cx - v.x) * (k / v.k); v.y = cy - (cy - v.y) * (k / v.k); v.k = k; this.applyView(); }
  fit() {
    const ns = [...this.nodes.values()]; if (!ns.length) return; const full = this.svg.getBoundingClientRect(); const pad = 90;
    // keep clear of the side panel on wide screens
    const right = full.width > 1080 && this.svg.parentNode.querySelector('.panel') ? 400 : 0; const left = full.width > 1280 ? 220 : 0; const r = { width: full.width - right - left, height: full.height - 60 };
    const x0 = Math.min(...ns.map(n => n.x - n.r)), x1 = Math.max(...ns.map(n => n.x + n.r)), y0 = Math.min(...ns.map(n => n.y - n.r)), y1 = Math.max(...ns.map(n => n.y + n.r));
    const k = Math.max(0.12, Math.min(1.15, Math.min((r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0))));
    this.view = { k, x: left + r.width / 2 - ((x0 + x1) / 2) * k, y: r.height / 2 - ((y0 + y1) / 2) * k + 40 }; this.applyView();
  }
  startConnect(key) { this.connectFrom = key; this.svg.classList.add('connecting'); this.live.style.display = ''; this.live.setAttribute('d', ''); }
  cancelConnect() { this.connectFrom = null; this.svg.classList.remove('connecting'); this.live.style.display = 'none'; }
  bind() {
    const svg = this.svg; let down = null;
    svg.addEventListener('wheel', ev => { ev.preventDefault(); const r = svg.getBoundingClientRect(); this.zoom(Math.exp(-ev.deltaY * 0.0014), ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    svg.addEventListener('pointerdown', ev => { const g = ev.target.closest('.node'); const node = g ? this.nodes.get(g.dataset.key) : null;
      down = { x: ev.clientX, y: ev.clientY, node, vx: this.view.x, vy: this.view.y, moved: false }; svg.setPointerCapture(ev.pointerId); if (!node) svg.classList.add('panning'); });
    svg.addEventListener('pointermove', ev => {
      if (this.connectFrom) { const s = this.nodes.get(this.connectFrom); const w = this.toWorld(ev); if (s) this.live.setAttribute('d', this.ropePath(s, w, 0.12)); }
      if (!down) return; const dx = ev.clientX - down.x, dy = ev.clientY - down.y; if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true; if (!down.moved) return;
      if (down.node && !this.connectFrom) { const w = this.toWorld(ev); down.node.x = w.x; down.node.y = w.y; down.node.held = true; this.dragging = true; this.heat(0.5); }
      else if (!down.node) { this.view.x = down.vx + dx; this.view.y = down.vy + dy; this.applyView(); } });
    const up = ev => { if (!down) return; const d = down; down = null; svg.classList.remove('panning'); this.dragging = false; if (d.node) d.node.held = false;
      if (d.moved) return; if (!d.node) { if (this.connectFrom) this.on.cancel(); return; }
      // a second click on the same node within a moment counts as a double-click (the pointer is captured, so the browser's own event never reaches the node)
      const now = Date.now(); if (last.key === d.node.key && now - last.at < 380 && !this.connectFrom) { last = { key: null, at: 0 }; return this.on.open(d.node); }
      last = { key: d.node.key, at: now }; this.on.click(d.node, ev); };
    let last = { key: null, at: 0 };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  }
  destroy() { cancelAnimationFrame(this.raf); this.raf = 0; }
}

export async function explorer(root, { id }) {
  const manage = can('frameworks', 'manage'); const cache = new Map(); let overview = null; let mode = 'overview';
  const svg = el('svg', { class: 'web' }); const panelSlot = h('div'); const hint = h('div.hint.glass'); const results = h('div');
  const search = h('input', { type: 'search', placeholder: 'Find a control — try “access” or A.5.15', 'aria-label': 'Find a control' });
  const backBtn = btn('All frameworks', () => showOverview()); backBtn.prepend(icon('back', 15));
  const stage = h('section.stage', null, svg,
    h('div.hud.tl', null, h('div.label', null, 'Control map'), h('h1', null, 'Follow the ropes.'),
      h('div.search', null, search), results, h('div.row', { style: 'margin-top:12px' }, backBtn, btn('Browse as a list', () => location.hash = '#/frameworks'))),
    panelSlot, hint,
    h('div.hud.bl.glass.keys', null, h('span', null, h('i'), 'Direct'), h('span', null, h('i', { style: 'opacity:.35' }), 'Partial'), h('span', null, h('i', { style: 'border-color:#34d399' }), 'Your own mapping'),
      h('span', null, h('i', { style: 'border-top:2px dashed #a78bfa' }), 'Your records')),
    h('div.hud.br.glass', null, h('button.zoom', { onclick: () => web.zoom(1.3), 'aria-label': 'Zoom in' }, icon('plus', 18)), h('button.zoom', { onclick: () => web.zoom(1 / 1.3), 'aria-label': 'Zoom out' }, icon('minus', 18)),
      h('button.zoom', { onclick: () => web.fit(), 'aria-label': 'Fit to screen' }, icon('fit', 18))));
  setHero(stage);

  const web = new Web(svg, {
    click: node => { if (web.connectFrom) return tie(node); select(node); },
    open: node => { if (node.kind === 'fw') select(node); else if (node.kind === 'control') expand(node.data.id); else if (node.data?.href) location.hash = node.data.href; },
    cancel: () => { web.cancelConnect(); setHint(); },
  });
  const setHint = text => { hint.textContent = text || (mode === 'overview' ? 'Click a framework to look inside · scroll to zoom · drag to move' : 'Double-click a control to pull out its ropes · drag anything'); };
  const onKey = e => { if (e.key === 'Escape' && web.connectFrom) { web.cancelConnect(); setHint(); } }; document.addEventListener('keydown', onKey);
  const load = async cid => { if (!cache.has(cid)) cache.set(cid, await api.get('/graph/control/' + cid)); return cache.get(cid); };
  const ctlNode = (c, extra = {}) => ({ key: 'c' + c.id, kind: 'control', r: 6 + Math.min(9, Math.sqrt(c.degree || 1) * 1.3), color: colorOf(c.region), label: c.ref, sub: c.framework, data: c, ...extra });

  // ── Level 1: all frameworks ──
  async function showOverview() {
    mode = 'overview'; backBtn.classList.add('hidden'); clear(panelSlot); web.reset(); web.center();
    overview ??= await api.get('/graph/overview'); const fws = overview.frameworks; const regions = [...new Set(fws.map(f => f.region))];
    // Frameworks gather by region; the ropes between them show how strongly two frameworks are related
    web.charge = 150; web.spring = 0;
    regions.forEach((region, ri) => { const members = fws.filter(f => f.region === region); const ra = -Math.PI / 2 + (ri / regions.length) * Math.PI * 2; const R = regions.length > 1 ? 330 : 0;
      const cx = Math.cos(ra) * R * 1.25, cy = Math.sin(ra) * R * 0.8; const spread = 46 + members.length * 17;
      members.forEach((f, i) => { const a2 = (i / members.length) * Math.PI * 2 + ri; const tx = cx + Math.cos(a2) * (members.length > 1 ? spread : 0), ty = cy + Math.sin(a2) * (members.length > 1 ? spread : 0);
        web.addNode({ key: 'f' + f.id, kind: 'fw', r: 12 + Math.sqrt(f.controls) * 0.95, color: colorOf(f.region), label: f.code, ring: !!f.adopted, data: f, x: tx * 0.6, y: ty * 0.6, tx, ty }); }); });
    const top = Math.max(...overview.edges.map(e => e.n), 1);
    for (const e of [...overview.edges].sort((x, y) => y.n - x.n).slice(0, 110)) web.addEdge('f' + e.a, 'f' + e.b, e.n > top * 0.25 ? 'direct' : '', 200, 0.6 + 4 * (e.n / top));
    web.heat(1); setTimeout(() => web.fit(), 900); setHint(); if (location.hash !== '#/map') history.replaceState(null, '', '#/map');
  }
  function frameworkPanel(f) {
    const pairs = overview.edges.filter(e => e.a === f.id || e.b === f.id).map(e => ({ other: overview.frameworks.find(x => x.id === (e.a === f.id ? e.b : e.a)), n: e.n })).filter(p => p.other).sort((a, b) => b.n - a.n);
    const list = h('div.results'); const q = h('input', { type: 'search', placeholder: `Search ${f.code}` }); let timer;
    const run = async () => { const rows = await api.get(`/controls/search?framework_id=${f.id}&q=${encodeURIComponent(q.value)}`);
      mount(clear(list), rows.slice(0, 30).map(c => h('div.opt', { onclick: () => focus(c.id) }, h('b', null, c.ref), ' ', c.title || cleanText(c.description).slice(0, 70)))); };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); }); run();
    mount(clear(panelSlot), h('aside.panel.glass', null, h('div.label', null, f.region), h('h2', null, f.code), h('p', null, f.name),
      h('div', null, h('span.tag', null, `${f.controls.toLocaleString()} controls`), f.adopted ? h('span.tag', null, h('i', { style: 'background:#34d399' }), 'In your scope') : null),
      pairs.length ? [h('h3', null, 'Most ropes to'), pairs.slice(0, 5).map(p => h('span.tag', null, h('i', { style: `background:${colorOf(p.other.region)}` }), `${p.other.code} · ${p.n.toLocaleString()}`))] : null,
      h('h3', null, 'Open a control'), h('div.search', null, q), list));
  }

  // ── Level 2: one control and everything tied to it ──
  async function focus(cid) {
    const d = await attempt(() => load(cid)); if (!d) return;
    mode = 'control'; backBtn.classList.remove('hidden'); web.reset(); web.center(); web.charge = 46; web.spring = 0.035; clear(results); search.value = '';
    web.addNode(ctlNode({ ...d.node, region: regionOf(d.node.framework_id) }, { r: 17, x: 0, y: 0 }));
    attach(d, true); select(web.nodes.get('c' + cid)); web.heat(1); setTimeout(() => web.fit(), 700); setHint();
    history.replaceState(null, '', '#/map/' + cid);
  }
  const regionOf = fid => state.lookups.frameworks.find(f => f.id === fid)?.region;
  // Adds a control's ropes to the web. Returns how many could not be shown.
  function attach(d, withRecords) {
    const src = web.nodes.get('c' + d.node.id); let skipped = 0; const byFw = [...new Set(d.links.map(l => l.framework_id))];
    d.links.forEach(l => {
      if (!web.nodes.has('c' + l.id)) { if (web.nodes.size >= MAX_NODES) { skipped++; return; }
        const ang = (byFw.indexOf(l.framework_id) / byFw.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5; const rad = 150 + Math.random() * 70;
        web.addNode(ctlNode(l, { x: src.x + Math.cos(ang) * rad, y: src.y + Math.sin(ang) * rad })); }
      web.addEdge('c' + d.node.id, 'c' + l.id, l.own ? 'own' : l.confidence === 'Direct' ? 'direct' : '', l.confidence === 'Partial' ? 150 : 110);
    });
    if (withRecords) d.records.forEach((r, i) => { const ang = -Math.PI / 2 + (i - (d.records.length - 1) / 2) * 0.5;
      web.addNode({ key: r.key, kind: 'record', r: 8, color: RECORD[r.kind][0], label: r.label, sub: RECORD[r.kind][1], data: r, x: src.x + Math.cos(ang) * 70, y: src.y + Math.sin(ang) * 70 }); web.addEdge('c' + d.node.id, r.key, 'rec', 70); });
    return skipped;
  }
  async function expand(cid) {
    const d = await attempt(() => load(cid)); if (!d) return; const skipped = attach(d, true); web.heat(0.9); web.select('c' + cid); controlPanel(d);
    if (skipped) toast(`${skipped} more ropes are not drawn to keep the picture readable. Open one of the controls to continue from there.`);
  }
  function controlPanel(d) {
    const n = d.node; const frameworks = new Set(d.links.map(l => l.framework)); const shown = web.nodes.has('c' + n.id) ? web.degree('c' + n.id) : 0; const own = d.links.filter(l => l.own);
    const text = cleanText(n.description); const body = h('p', null, text.length > 240 ? text.slice(0, 240) + '…' : text);
    if (text.length > 240) body.append(' ', h('a', { onclick: () => { body.textContent = text; } }, 'Read all'));
    const pos = d.position;
    mount(clear(panelSlot), h('aside.panel.glass', null, h('div.label', null, n.framework), h('h2', null, n.ref), n.title ? h('p', null, h('b', null, n.title)) : null, body,
      pos && !pos.na ? h('div', { style: 'margin-top:10px' }, h('span.tag', null, h('i', { style: `background:${pos.doc.state === 'gap' ? '#71717a' : '#34d399'}` }), `Documentation: ${STATE_TEXT[pos.doc.state]}`),
        h('span.tag', null, h('i', { style: `background:${pos.impl.state === 'gap' ? '#71717a' : '#a78bfa'}` }), `Implementation: ${STATE_TEXT[pos.impl.state]}`)) : null,
      h('h3', null, d.links.length ? `Tied to ${d.links.length} control${d.links.length > 1 ? 's' : ''} in ${frameworks.size} framework${frameworks.size > 1 ? 's' : ''}` : 'No ropes to other frameworks'),
      h('div.stack.tight', null, d.links.length && shown < d.links.length + d.records.length ? btn('Pull out its ropes', () => expand(n.id), 'primary') : null,
        btn('Open the control', () => location.hash = '#/controls/' + n.id), manage && n.assessable ? btn('Tie it to another control', () => { web.startConnect('c' + n.id); setHint('Click the control to tie it to · Esc to cancel'); }) : null),
      d.records.length ? [h('h3', null, 'Your records on this control'), d.records.map(r => h('a.rec', { href: r.href }, h('i', { style: `background:${RECORD[r.kind][0]}` }),
        h('span', null, h('b', null, `${RECORD[r.kind][1]} ${r.kind === 'question' ? '' : r.label}`), h('div', null, r.title), r.status ? h('div.small', { style: 'opacity:.6' }, String(r.status).replace(/_/g, ' ')) : null)))] : null,
      own.length ? [h('h3', null, 'Your own mappings'), own.map(l => h('div.rec', null, h('i', { style: 'background:#34d399;border-radius:50%' }), h('span.grow', null, h('b', null, `${l.framework} ${l.ref}`)),
        manage ? h('a', { onclick: async () => { if (await confirmBox(`Untie ${n.ref} from ${l.framework} ${l.ref}?`, 'Untie', 'danger') && await attempt(() => api.del(`/controls/${n.id}/links/${l.id}`), 'Mapping removed')) { cache.delete(n.id); cache.delete(l.id); web.removeEdge('c' + n.id, 'c' + l.id); controlPanel(await load(n.id)); } } }, 'Untie') : null))] : null));
  }
  function recordPanel(r) {
    mount(clear(panelSlot), h('aside.panel.glass', null, h('div.label', null, RECORD[r.kind][1]), h('h2', { style: 'font-size:22px' }, r.kind === 'question' ? 'Audit question' : r.label), h('p', null, r.title),
      r.status ? h('span.tag', null, String(r.status).replace(/_/g, ' ')) : null, h('div', { style: 'margin-top:16px' }, btn('Open it', () => location.hash = r.href, 'primary'))));
  }
  async function select(node) {
    web.select(node.key);
    if (node.kind === 'fw') return frameworkPanel(node.data);
    if (node.kind === 'record') return recordPanel(node.data);
    const d = await attempt(() => load(node.data.id)); if (d) controlPanel(d);
  }
  // Ties the control being connected to the clicked one: an own mapping, visible to this organisation only.
  async function tie(target) {
    const from = web.nodes.get(web.connectFrom); if (!from || target.kind !== 'control' || target.key === from.key) return toast('Pick another control to tie it to', 'bad');
    const a = from.data, b = target.data;
    if (!(await confirmBox(`Tie ${a.framework} ${a.ref} to ${b.framework} ${b.ref}? From now on, evidence for one counts for the other in your organisation.`, 'Tie them'))) return;
    if (await attempt(() => api.post(`/controls/${a.id}/links`, { target_id: b.id }), 'Tied together')) { cache.delete(a.id); cache.delete(b.id); web.addEdge(from.key, target.key, 'own', 110); web.heat(0.6); }
    web.cancelConnect(); setHint(); controlPanel(await load(a.id));
  }

  // Search across every framework
  let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (!search.value.trim()) return clear(results);
    const rows = await api.get('/controls/search?q=' + encodeURIComponent(search.value));
    mount(clear(results), h('div.results.glass', null, rows.length ? rows.slice(0, 12).map(c => h('div.opt', { onclick: () => focus(c.id) }, h('b', null, `${c.framework} ${c.ref}`), ' ', c.title || '')) : h('div.opt', null, 'Nothing matches')));
  }, 220); });

  if (id) await focus(Number(id)); else await showOverview();
  return () => { web.destroy(); document.removeEventListener('keydown', onKey); };
}
