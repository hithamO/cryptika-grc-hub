import { h, mount, api, state, pageHead, btn, can, sectionHead, scoreTag, tick } from '../ui.js';
import { ring, donut, bars, stackBar, riskMatrix } from '../charts.js';

const MINT = '#34d399', VIOLET = '#a78bfa', GREEN = '#0f9f6e', PLUM = '#6a35a0';
const SEV = { Critical: '#d4433a', High: '#e0742b', Medium: '#d4a11e', Low: '#3fa37a' };
const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function home(root) {
  const d = await api.get('/dashboard'); const me = state.me; const first = me.user.name.split(' ')[0];
  const waiting = [d.approvals.length ? plural(d.approvals.length, 'approval', 'approvals') : null, d.evidence_requests ? plural(d.evidence_requests, 'evidence request', 'evidence requests') : null].filter(Boolean);

  // Header: one sentence, the next action, and the headline figure
  const side = [];
  if (d.overall) side.push(h('div.glass', { style: 'padding:26px 30px;display:flex;gap:26px;align-items:center' },
    ring({ rings: [{ pct: d.overall.doc, color: MINT }, { pct: d.overall.impl, color: VIOLET }], size: 190, stroke: 13, gap: 7, track: 'rgba(255,255,255,.09)', cls: 'xl', mid: [h('b', null, tick(`${d.overall.pct}%`, 1500)), h('span', null, 'compliant')] }),
    h('div.stack', null, h('div', null, h('div.label', null, 'Documentation'), h('div', { style: `font-size:26px;font-weight:600;color:${MINT};letter-spacing:-.04em` }, tick(`${d.overall.doc}%`, 1500))),
      h('div', null, h('div.label', null, 'Implementation'), h('div', { style: `font-size:26px;font-weight:600;color:${VIOLET};letter-spacing:-.04em` }, tick(`${d.overall.impl}%`, 1500))))));
  const stats = [d.policies && { v: d.policies.published, l: 'Policies in force' }, d.risks && { v: d.risks.above_appetite, l: 'Risks above appetite' }, d.findings && { v: d.findings.reduce((s, f) => s + f.n, 0), l: 'Open findings' }].filter(Boolean);
  if (stats.length) side.push(h('div.stack', { style: 'gap:14px;justify-content:center' }, stats.map(s => h('div.glass.glass-stat', null, h('div.v', null, tick(s.v)), h('div.l', null, s.l)))));
  pageHead(`${greeting()}, ${first}.`, waiting.length ? `${waiting.join(' and ')} waiting for you.` : 'Nothing is waiting for you today.', [
    d.approvals.length ? btn('Review approvals', () => location.hash = '#/approvals', 'primary') : null,
    d.evidence_requests ? btn('Open evidence requests', () => location.hash = '#/compliance/requests', d.approvals.length ? '' : 'primary') : null,
    !waiting.length && can('compliance') ? btn('See compliance position', () => location.hash = '#/compliance', 'primary') : null,
    can('frameworks') ? btn('Explore the control map', () => location.hash = '#/map') : null,
  ], null, { tall: true, side });

  // Frameworks in scope: two rings each — documentation outside, implementation inside
  if (d.frameworks) {
    mount(root, sectionHead('Frameworks in scope', null, h('div.legend', null, h('span.direct', null, 'Documentation'), h('span.inherited', null, 'Implementation'))),
      d.frameworks.length ? h('div.grid.g3', null, d.frameworks.map((f, i) => h('div.card.lift.fw-card.rise', { style: `animation-delay:${i * 0.05}s`, onclick: () => location.hash = '#/compliance/frameworks/' + f.id },
        ring({ rings: [{ pct: f.summary.doc.pct, color: GREEN }, { pct: f.summary.impl.pct, color: PLUM }], size: 92, stroke: 8, gap: 4, mid: h('b', null, tick(`${Math.round(f.summary.overall_pct)}%`)) }),
        h('div.grow', null, h('div.label', null, f.requirement === 'mandatory' ? 'Mandatory' : 'Voluntary'), h('h3', { style: 'margin:6px 0 4px' }, f.code), h('div.muted.small', null, `${f.summary.applicable} controls`)))))
        : h('div.card', null, h('div.empty', null, h('b', null, 'No framework in scope yet'), h('a', { href: '#/governance/regulations' }, 'Choose the laws and standards you follow'))));
  }

  // Risk landscape
  if (d.risks) {
    const vt = d.vulns.reduce((s, v) => s + v.n, 0);
    mount(root, h('div.dark-block.rise', { style: 'margin-top:34px' },
      h('div.row.between.wrap', { style: 'margin-bottom:26px' }, h('div', null, h('div.label', null, 'Risk'), h('h2', { style: 'margin-top:8px' }, 'Risk landscape')), btn('Open the register', () => location.hash = '#/risk/register')),
      h('div.grid', { style: 'grid-template-columns:minmax(240px,1fr) minmax(220px,.8fr) minmax(280px,1.3fr);gap:40px;align-items:center' },
        h('div', null, h('div.label', { style: 'margin-bottom:12px' }, `Inherent risk · ${d.risks.scored} scored`), riskMatrix(d.risks.matrix), h('div.small.center', { style: 'margin-top:8px;color:rgba(255,255,255,.4)' }, 'Likelihood ↑   Impact →')),
        h('div.stack', { style: 'align-items:center' }, donut({ segments: ['Critical', 'High', 'Medium', 'Low'].map(s => ({ value: d.vulns.find(v => v.severity === s)?.n || 0, color: SEV[s] })), size: 170, stroke: 18,
          mid: [h('b', { style: 'font-size:34px;color:#fff' }, tick(vt, 1400)), h('span', { style: 'color:rgba(255,255,255,.55)' }, 'open vulnerabilities')] }),
          h('div.row.wrap', { style: 'gap:12px;justify-content:center;font-size:12px' }, ['Critical', 'High', 'Medium', 'Low'].map(s => h('span.row', { style: 'gap:6px' }, h('i', { style: `width:8px;height:8px;border-radius:50%;background:${SEV[s]};display:block` }), s)))),
        h('div', null, h('div.label', { style: 'margin-bottom:12px' }, 'Highest residual risks'),
          d.risks.top.length ? h('div.stack', { style: 'gap:10px' }, d.risks.top.map(r => h('div.glass', { style: 'padding:12px 16px;display:flex;gap:14px;align-items:center;border-radius:1rem' },
            h('div.grow', null, h('b', { style: 'font-weight:500;font-size:13.5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.title), h('div.small', { style: 'color:rgba(255,255,255,.45)' }, r.ref)),
            scoreTag(r.inherent, r.inherent_level), h('span', { style: 'color:rgba(255,255,255,.4)' }, '→'), scoreTag(r.residual, r.residual_level))))
            : h('p', null, 'No risk has been scored yet.')))));
  }

  // Work in motion
  const tiles = [];
  if (d.policies) { const total = d.policies.published + d.policies.in_review + d.policies.draft;
    tiles.push(h('div.card.pad.lift.stack', { onclick: () => location.hash = '#/policies' }, h('div.label', null, 'Policies'), h('div.pct', null, tick(total), h('small', null, ' documents')),
      stackBar([{ label: 'In force', value: d.policies.published, color: GREEN }, { label: 'In review', value: d.policies.in_review, color: PLUM }, { label: 'Draft', value: d.policies.draft, color: '#d4d4d8' }]),
      h('div.legend', null, h('span.direct', null, `${d.policies.published} in force`), h('span.inherited', null, `${d.policies.in_review} in review`), h('span', null, `${d.policies.draft} draft`)))); }
  if (d.gaps) tiles.push(h('div.card.pad.lift.stack', { onclick: () => location.hash = '#/compliance/gaps' }, h('div.label', null, 'Evidence collection'),
    d.gaps.length ? [h('div.pct', null, tick(d.gaps.reduce((s, g) => s + g.submitted, 0)), h('small', null, ' to review')), bars(d.gaps.map(g => ({ label: g.framework, value: g.valid, text: `${g.valid}/${g.items}`, color: GREEN })), Math.max(...d.gaps.map(g => g.items)))]
      : h('p.muted', null, 'No gap assessment is running.')));
  if (d.findings) { const total = d.findings.reduce((s, f) => s + f.n, 0);
    tiles.push(h('div.card.pad.lift.stack', { onclick: () => location.hash = '#/audit/findings' }, h('div.label', null, 'Audit findings'), h('div.pct', null, tick(total), h('small', null, ' open')),
      total ? bars(['Critical', 'High', 'Medium', 'Low'].map(s => ({ label: s, value: d.findings.find(f => f.severity === s)?.n || 0, color: SEV[s] }))) : h('p.muted', null, 'Nothing open.'))); }
  if (tiles.length) mount(root, sectionHead('Work in motion'), h('div.grid', { style: `grid-template-columns:repeat(${tiles.length},minmax(0,1fr))` }, tiles));

  if (d.approvals.length) mount(root, sectionHead('Waiting for your decision'), h('div.grid.g3', null, d.approvals.map(a => h('a.card.pad.lift.stack.tight', { href: a.link },
    h('div.label', null, a.current.name), h('h3', null, a.title), h('div.muted.small', null, `Step ${a.stage_index + 1} of ${a.stages.length}`)))));
}
