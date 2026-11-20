'use strict';
// Reports: management summary and CSV exports. Everything is read straight from the operational data.
const { all, get } = require('../db');
const { need, can } = require('../auth');
const { bad, forbidden } = require('../lib/http');
const csv = require('../lib/csv');
const coverage = require('../services/coverage');
const { scoreItem } = require('./risk');
const { visibleFramework } = require('./library');

function latestRiskScores(t) {
  const items = all(`SELECT i.*, r.ref, r.title, r.risk_type, ra.ref assessment_ref, ra.appetite FROM risk_assessment_items i JOIN risks r ON r.id=i.risk_id JOIN risk_assessments ra ON ra.id=i.assessment_id
    WHERE i.tenant_id=? AND i.id IN (SELECT max(id) FROM risk_assessment_items WHERE tenant_id=? AND likelihood IS NOT NULL GROUP BY risk_id)`, t, t);
  const ctrls = all('SELECT item_id, effectiveness FROM risk_item_controls WHERE tenant_id=?', t);
  return items.map(i => ({ ref: i.ref, title: i.title, risk_type: i.risk_type, likelihood: i.likelihood, impact: i.impact, treatment: i.treatment, assessment_ref: i.assessment_ref, appetite: i.appetite,
    ...scoreItem(i, ctrls.filter(c => c.item_id === i.id)) }));
}
module.exports = router => {
  router.get('/reports/management', need('reports'), ctx => {
    const t = ctx.t;
    return {
      generated_at: new Date().toISOString(), tenant: get('SELECT name FROM tenants WHERE id=?', t).name, profile: get('SELECT * FROM company_profile WHERE tenant_id=?', t),
      frameworks: coverage.overview(t).filter(f => f.adopted),
      policies: all(`SELECT status, count(*) n FROM policies WHERE tenant_id=? AND status!='retired' GROUP BY status`, t),
      risks: { register: all(`SELECT status, count(*) n FROM risks WHERE tenant_id=? GROUP BY status`, t), scored: latestRiskScores(t).sort((a, b) => (b.residual ?? 0) - (a.residual ?? 0)) },
      vulnerabilities: all(`SELECT severity, count(*) n FROM vulnerabilities WHERE tenant_id=? AND status='open' GROUP BY severity`, t),
      gap_assessments: all(`SELECT ga.ref, ga.name, ga.status, f.code framework, (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id) items,
          (SELECT count(*) FROM gap_items i WHERE i.assessment_id=ga.id AND i.status='valid') valid FROM gap_assessments ga JOIN frameworks f ON f.id=ga.framework_id WHERE ga.tenant_id=? ORDER BY ga.id DESC`, t),
      findings: all(`SELECT severity, status, count(*) n FROM findings WHERE tenant_id=? GROUP BY severity, status`, t),
      partial_weight: coverage.tenantSettings(t).partial_weight,
    };
  });
  router.get('/reports/risk-scores', need('risk'), ctx => latestRiskScores(ctx.t));
  router.get('/reports/export/:kind', need('reports'), ctx => {
    const t = ctx.t; let headers, rows, name = ctx.params.kind;
    const label = { direct: 'Met — own evidence', inherited: 'Met — inherited (direct mapping)', inherited_partial: 'Partly met — inherited (partial mapping)', gap: 'Gap' };
    switch (ctx.params.kind) {
      case 'compliance': {
        if (!can(ctx.user, 'compliance')) throw forbidden();
        const f = visibleFramework(ctx, ctx.query.framework_id); const cov = coverage.framework(t, f.id); name = `compliance-${f.code}`;
        headers = ['Framework', 'Control ID', 'Control Title', 'Applicable', 'Documentation Status', 'Implementation Status'];
        rows = cov.controls.map(c => [f.code, c.ref, c.title, c.na ? 'No' : 'Yes', label[c.doc.state], label[c.impl.state]]); break;
      }
      case 'policies':
        headers = ['Reference', 'Title', 'Type', 'Category', 'Version', 'Status', 'Owner', 'Published', 'Review Date', 'Clauses', 'Mapped Controls'];
        rows = all(`SELECT p.ref,p.title,p.doc_type,p.category,p.version,p.status,u.name,p.published_at,p.review_date,(SELECT count(*) FROM policy_clauses pc WHERE pc.policy_id=p.id),
          (SELECT count(DISTINCT cc.control_id) FROM clause_controls cc JOIN policy_clauses pc ON pc.id=cc.clause_id WHERE pc.policy_id=p.id) FROM policies p LEFT JOIN users u ON u.id=p.owner_id WHERE p.tenant_id=? ORDER BY p.id`, t).map(Object.values); break;
      case 'risks':
        if (!can(ctx.user, 'risk')) throw forbidden();
        headers = ['Risk ID', 'Title', 'Type', 'Likelihood', 'Impact', 'Inherent Score', 'Inherent Level', 'Treatment', 'Residual Score', 'Residual Level', 'Assessment'];
        rows = latestRiskScores(t).map(r => [r.ref, r.title, r.risk_type, r.likelihood, r.impact, r.inherent, r.inherent_level, r.treatment, r.residual, r.residual_level, r.assessment_ref]); break;
      case 'assets':
        if (!can(ctx.user, 'risk')) throw forbidden();
        headers = ['Asset ID', 'Name', 'Type', 'IP Address', 'Hostname', 'Owner', 'Custodian', 'Criticality'];
        rows = all('SELECT ref,name,asset_type,ip_address,hostname,owner,custodian,criticality FROM assets WHERE tenant_id=? ORDER BY id', t).map(Object.values); break;
      case 'vulnerabilities':
        if (!can(ctx.user, 'risk')) throw forbidden();
        headers = ['Vulnerability ID', 'Asset', 'Title', 'Severity', 'CVSS', 'CVE', 'Port', 'Category', 'Status'];
        rows = all(`SELECT v.ref,a.name,v.title,v.severity,v.cvss,v.cve,v.port,c.name,v.status FROM vulnerabilities v JOIN assets a ON a.id=v.asset_id LEFT JOIN vuln_categories c ON c.id=v.category_id WHERE v.tenant_id=? ORDER BY v.id`, t).map(Object.values); break;
      case 'findings':
        if (!can(ctx.user, 'audit')) throw forbidden();
        headers = ['Finding ID', 'Audit', 'Title', 'Type', 'Severity', 'Status', 'Owner', 'Due Date'];
        rows = all(`SELECT x.ref,a.ref,x.title,x.finding_type,x.severity,x.status,x.owner,x.due_date FROM findings x LEFT JOIN audits a ON a.id=x.audit_id WHERE x.tenant_id=? ORDER BY x.id`, t).map(Object.values); break;
      default: throw bad('Unknown export');
    }
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.csv"` });
    ctx.res.end(csv.stringify(headers, rows));
  });
};

module.exports.latestRiskScores = latestRiskScores;
