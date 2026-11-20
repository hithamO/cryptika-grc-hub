// Small SVG charts drawn by hand: rings, bars, stacked bars and the 5×5 risk matrix.
import { h } from './ui.js';
const cellOf = v => Math.min(5, Math.max(1, Math.ceil(Number(v) - 1e-9)));   // a score between two steps sits in the higher cell
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const later = fn => requestAnimationFrame(() => requestAnimationFrame(fn));

// Concentric progress rings. rings: [{ pct, color }] from the outside in.
export function ring({ rings, size = 96, stroke = 9, gap = 4, track = 'rgba(113,113,122,.16)', mid, cls = '' }) {
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  rings.forEach((r, i) => {
    const rad = size / 2 - stroke / 2 - i * (stroke + gap); const c = 2 * Math.PI * rad;
    svg.append(svgEl('circle', { cx: size / 2, cy: size / 2, r: rad, stroke: track, 'stroke-width': stroke }));
    const arc = svgEl('circle', { cx: size / 2, cy: size / 2, r: rad, stroke: r.color, 'stroke-width': stroke, 'stroke-dasharray': c, 'stroke-dashoffset': c });
    svg.append(arc); later(() => arc.setAttribute('stroke-dashoffset', c * (1 - Math.min(100, Math.max(0, r.pct)) / 100)));
  });
  return h('div.ring', { class: cls, style: `width:${size}px;height:${size}px` }, svg, mid ? h('div.mid', null, mid) : null);
}
// Donut with several segments. segments: [{ value, color }]
export function donut({ segments, size = 150, stroke = 16, track = 'rgba(255,255,255,.08)', mid }) {
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` }); const rad = size / 2 - stroke / 2; const c = 2 * Math.PI * rad;
  const total = segments.reduce((s, x) => s + x.value, 0);
  svg.append(svgEl('circle', { cx: size / 2, cy: size / 2, r: rad, stroke: track, 'stroke-width': stroke }));
  let offset = 0;
  for (const seg of segments) { if (!seg.value) continue; const len = (seg.value / total) * c;
    const arc = svgEl('circle', { cx: size / 2, cy: size / 2, r: rad, stroke: seg.color, 'stroke-width': stroke, 'stroke-dasharray': `0 ${c}`, 'stroke-dashoffset': -offset, style: 'stroke-linecap:butt;transition:stroke-dasharray 1.1s cubic-bezier(.16,1,.3,1)' });
    svg.append(arc); later(() => arc.setAttribute('stroke-dasharray', `${Math.max(0, len - 2)} ${c}`)); offset += len; }
  return h('div.ring', { style: `width:${size}px;height:${size}px` }, svg, mid ? h('div.mid', null, mid) : null);
}
// Horizontal bars. items: [{ label, value, color, text }]
export function bars(items, max) {
  const top = max || Math.max(1, ...items.map(i => i.value));
  return h('div.bars', null, items.map(i => { const fill = h('i.fill', { style: `background:${i.color}` }); later(() => fill.style.width = `${(i.value / top) * 100}%`);
    return h('div.bar', null, h('span', null, i.label), h('div.track', null, fill), h('b.num.right', null, i.text ?? String(i.value))); }));
}
export function stackBar(segments) {
  return h('div.stackbar', null, segments.filter(s => s.value).map(s => { const el = h('i', { style: `background:${s.color}`, title: `${s.label}: ${s.value}` }); later(() => el.style.flexGrow = s.value); return el; }));
}
export const riskLevel = s => s >= 17 ? 'Critical' : s >= 10 ? 'High' : s >= 5 ? 'Medium' : 'Low';
// 5×5 matrix with the number of risks in each cell. points: [[likelihood, impact], …]
export function riskMatrix(points) {
  const grid = h('div.matrix');
  for (let l = 5; l >= 1; l--) { grid.append(h('div.ax', null, String(l)));
    for (let i = 1; i <= 5; i++) { const n = points.filter(p => cellOf(p[0]) === l && cellOf(p[1]) === i).length;
      grid.append(h('div.cell', { style: `--i:${(5 - l) + i}`, class: `lv-${riskLevel(l * i)}${n ? '' : ' zero'}`, title: `Likelihood ${l} × impact ${i} = ${l * i}` }, n ? String(n) : '')); } }
  grid.append(h('div.ax'), ...[1, 2, 3, 4, 5].map(i => h('div.ax', null, String(i))));
  return grid;
}
