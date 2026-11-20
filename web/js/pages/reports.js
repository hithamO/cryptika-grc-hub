import { h, mount, api, pageHead, btn, badge, covBar, covLegend, scoreTag, fmtDate, can, download, state } from '../ui.js';

export async function management(root) {
  const d = await api.get('/reports/management'); const sum = (rows, f) => rows.filter(f).reduce((s, r) => s + r.n, 0);
  const top = d.risks.scored.slice(0, 10);
  mount(root, pageHead('Management report', 'A printable summary of where the organisation stands.', [
    h('select', { onchange: e => { if (e.target.value) download(e.target.value); e.target.value = ''; } }, h('option', { value: '' }, 'Export data as CSV…'), h('option', { value: '/reports/export/policies' }, 'Policies'),
      can('risk') ? [h('option', { value: '/reports/export/risks' }, 'Risk scores'), h('option', { value: '/reports/export/assets' }, 'Assets'), h('option', { value: '/reports/export/vulnerabilities' }, 'Vulnerabilities')] : null,
      can('audit') ? h('option', { value: '/reports/export/findings' }, 'Findings') : null, can('compliance') ? d.frameworks.map(f => h('option', { value: '/reports/export/compliance?framework_id=' + f.id }, `Compliance — ${f.code}`)) : null),
    btn('Print', () => window.print(), 'primary')]),
    h('div.doc', { style: 'max-width:980px' }, h('div.muted.small', null, `${d.tenant} · ${fmtDate(d.generated_at)}`), h('h1', null, 'Governance, risk and compliance report'),
      h('p.muted', null, [d.profile?.sector, d.profile?.country].filter(Boolean).join(', ')),
      h('h2', null, '1. Compliance position'), d.frameworks.length ? [h('table', null, h('thead', null, h('tr', null, ['Framework', 'Requirement', 'Controls', 'Documentation', 'Implementation', 'Overall'].map(x => h('th', null, x)))),
        h('tbody', null, d.frameworks.map(f => h('tr', null, h('td', null, h('b', null, f.code), h('div.small.muted', null, f.name)), h('td', null, badge(f.requirement)), h('td.num', null, f.summary.applicable),
          h('td', null, covBar(f.summary.doc, f.summary.applicable), h('div.small.num', null, f.summary.doc.pct + '%')), h('td', null, covBar(f.summary.impl, f.summary.applicable), h('div.small.num', null, f.summary.impl.pct + '%')), h('td.num', null, h('b', null, f.summary.overall_pct + '%')))))),
        covLegend()] : h('p.muted', null, 'No framework in scope.'),
      h('h2', null, '2. Policies'), h('table', null, h('tbody', null, h('tr', null, h('th', null, 'In force'), h('td.num', null, sum(d.policies, p => p.status === 'published')), h('th', null, 'In review'), h('td.num', null, sum(d.policies, p => p.status === 'in_review')), h('th', null, 'Draft or returned'), h('td.num', null, sum(d.policies, p => ['draft', 'rejected'].includes(p.status)))))),
      h('h2', null, '3. Risk'), h('table', null, h('tbody', null, h('tr', null, h('th', null, 'Registered risks'), h('td.num', null, sum(d.risks.register, r => r.status === 'registered')), h('th', null, 'Awaiting confirmation'), h('td.num', null, sum(d.risks.register, r => r.status === 'pending')),
        h('th', null, 'Above appetite after treatment'), h('td.num', null, d.risks.scored.filter(r => r.residual > r.appetite).length)))),
      top.length ? h('table', null, h('thead', null, h('tr', null, ['Risk', 'Inherent', 'Treatment', 'Residual', 'Assessment'].map(x => h('th', null, x)))), h('tbody', null, top.map(r => h('tr', null, h('td', null, h('b', null, r.ref + ' '), r.title), h('td', null, scoreTag(r.inherent, r.inherent_level)), h('td', null, r.treatment ? r.treatment[0].toUpperCase() + r.treatment.slice(1) : '—'), h('td', null, scoreTag(r.residual, r.residual_level)), h('td', null, r.assessment_ref)))))
        : h('p.muted', null, 'No risk has been scored yet.'),
      h('table', null, h('tbody', null, h('tr', null, h('th', null, 'Open vulnerabilities'), ['Critical', 'High', 'Medium', 'Low'].map(s => [h('th', null, s), h('td.num', null, sum(d.vulnerabilities, v => v.severity === s))])))),
      h('h2', null, '4. Gap assessments'), d.gap_assessments.length ? h('table', null, h('thead', null, h('tr', null, ['Assessment', 'Framework', 'Status', 'Evidence validated'].map(x => h('th', null, x)))), h('tbody', null, d.gap_assessments.map(g => h('tr', null, h('td', null, `${g.ref} ${g.name}`), h('td', null, g.framework), h('td', null, badge(g.status)), h('td.num', null, `${g.valid} of ${g.items}`))))) : h('p.muted', null, 'None started.'),
      h('h2', null, '5. Audit findings'), h('table', null, h('tbody', null, h('tr', null, h('th', null, 'Open'), h('td.num', null, sum(d.findings, f => ['open', 'in_progress'].includes(f.status))), h('th', null, 'Of which critical or high'), h('td.num', null, sum(d.findings, f => ['open', 'in_progress'].includes(f.status) && ['Critical', 'High'].includes(f.severity))),
        h('th', null, 'Closed'), h('td.num', null, sum(d.findings, f => ['resolved', 'closed'].includes(f.status)))))),
      h('p.muted.small', { style: 'margin-top:24px' }, `Prepared by ${state.me.user.name}`)));
}
