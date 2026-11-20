'use strict';
// AI assistance. Every suggestion is advisory: a person confirms or overrides it.
// Two engines: a built-in rule-based engine (always available, works offline) and an optional
// OpenAI-compatible chat endpoint (OpenAI, Azure OpenAI, a local Ollama / LM Studio server, …) configured per tenant.
const { tenantSettings } = require('./coverage');

async function llmJson(settings, system, user) {
  if (settings.ai_provider !== 'openai-compatible' || !settings.ai_base_url || !settings.ai_model) return null;
  try {
    const res = await fetch(settings.ai_base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(45000),
      headers: { 'Content-Type': 'application/json', ...(settings.ai_api_key ? { Authorization: 'Bearer ' + settings.ai_api_key } : {}) },
      body: JSON.stringify({ model: settings.ai_model, temperature: 0.2, messages: [{ role: 'system', content: system + ' Reply with JSON only.' }, { role: 'user', content: user }] }),
    });
    if (!res.ok) return null;
    const text = (await res.json()).choices?.[0]?.message?.content || '';
    const m = /[\[{][\s\S]*[\]}]/.exec(text);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}
const has = (text, words) => words.some(w => text.includes(w));
const profileText = p => p ? `Organisation: ${p.legal_name || 'n/a'}; sector: ${p.sector || 'n/a'}; country: ${p.country || 'n/a'}; size: ${p.size || 'n/a'}.` : '';

// Control effectiveness on the 0–5 scale used by the residual-risk calculation.
function builtinEffectiveness(controlText, treatment) {
  const t = controlText.toLowerCase(); let score = 3; let why = 'General safeguard: moderate reduction assumed until tested.';
  if (has(t, ['disable', 'block', 'prohibit', 'remove', 'isolate', 'segregat', 'segment', 'air-gap'])) { score = 4.5; why = 'Preventive control that removes or blocks the exposure.'; }
  else if (has(t, ['encrypt', 'cryptograph', 'multi-factor', 'multifactor', 'mfa', 'authenticat', 'firewall', 'least privilege', 'access control', 'patch', 'harden', 'whitelist', 'allow-list'])) { score = 4; why = 'Preventive technical control with strong, well-understood effect.'; }
  else if (has(t, ['backup', 'restor', 'recover', 'continuity', 'redundan', 'failover', 'anti-virus', 'antivirus', 'anti-malware', 'malware'])) { score = 3.5; why = 'Limits the impact when the event occurs.'; }
  else if (has(t, ['monitor', 'log', 'detect', 'alert', 'review', 'audit', 'scan', 'test'])) { score = 2.5; why = 'Detective control: shortens exposure but does not prevent the event.'; }
  else if (has(t, ['policy', 'procedure', 'awareness', 'training', 'document', 'roles and responsibilities', 'agreement', 'contract'])) { score = 2; why = 'Administrative control: depends on people following it.'; }
  if (treatment === 'avoid' && score >= 4) why += ' Used to avoid the risk, it acts on likelihood.';
  return { score, rationale: why, engine: 'built-in rules' };
}
async function suggestEffectiveness(tenantId, { control, risk, profile, treatment }) {
  const settings = tenantSettings(tenantId);
  const text = `${control.title || ''} ${control.description || ''}`;
  const llm = await llmJson(settings, 'You are a senior information-security risk analyst. Rate how effectively a control reduces a specific risk on a 0–5 scale (5 = eliminates it, 0 = no effect), in steps of 0.5.',
    `${profileText(profile)}\nRisk: ${risk.title}. ${risk.description || ''}\nTreatment: ${treatment || 'mitigate'}\nControl: ${text}\nReturn {"score": number, "rationale": "one sentence"}`);
  if (llm && Number.isFinite(Number(llm.score))) return { score: Math.max(0, Math.min(5, Math.round(Number(llm.score) * 2) / 2)), rationale: String(llm.rationale || ''), engine: settings.ai_model };
  return builtinEffectiveness(text.toLowerCase(), treatment);
}

const DEPT_RULES = [
  ['Human Resources', ['personnel', 'screening', 'employment', 'disciplinary', 'awareness', 'training', 'human resource', 'onboarding', 'termination', 'hiring']],
  ['Legal', ['legal', 'contract', 'regulatory', 'statutory', 'intellectual property', 'privacy notice', 'consent', 'data subject', 'lawful']],
  ['Risk Management', ['risk assessment', 'risk management', 'risk treatment', 'risk appetite', 'risk register']],
  ['Internal Audit', ['internal audit', 'independent review', 'audit programme', 'audit program']],
  ['Executive Management', ['top management', 'leadership', 'board', 'management review', 'strategy', 'budget', 'steering']],
  ['Operations', ['physical', 'facility', 'premises', 'visitor', 'equipment siting', 'cabling', 'utilities', 'environmental', 'business continuity']],
  ['Compliance', ['policy', 'policies', 'compliance', 'documented information', 'supervisory authority', 'record of processing']],
  ['Information Security', ['incident', 'threat intelligence', 'security operations', 'vulnerability', 'penetration', 'classification', 'cryptograph', 'security event', 'siem']],
  ['Information Technology', ['network', 'firewall', 'backup', 'patch', 'server', 'configuration', 'malware', 'logging', 'access', 'authentication', 'password', 'endpoint', 'system', 'software', 'cloud', 'database', 'development', 'capacity']],
];
// Keyword scoring: a match in the title weighs three times a match in the body text.
const hits = (title, body, words) => words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
function suggestDepartment(control, departments) {
  const title = (control.title || '').toLowerCase(); const body = (control.description || '').toLowerCase();
  let best = null; let bestScore = 0;
  for (const [dept, words] of DEPT_RULES) { const sc = hits(title, body, words); if (sc > bestScore && departments.some(x => x.name === dept)) { best = dept; bestScore = sc; } }
  const d = departments.find(x => x.name === (best || 'Information Security')) || departments[0];
  return d ? d.id : null;
}
const EVIDENCE_RULES = [
  [['network', 'segment', 'firewall'], 'Current network diagram, plus screenshots of the firewall / core-switch rules that enforce the segmentation.'],
  [['backup', 'restor'], 'Backup job configuration and the last successful backup and restore-test reports.'],
  [['access', 'privilege', 'authentication', 'password', 'identity'], 'Screenshot of the access / password configuration and the latest user-access review record.'],
  [['awareness', 'training'], 'Training plan, attendance records and sample awareness material for the last 12 months.'],
  [['incident'], 'Incident register extract and one closed incident record showing the response steps.'],
  [['patch', 'vulnerab', 'malware', 'anti-virus', 'antivirus'], 'Latest vulnerability scan / patch compliance report and the console screenshot showing coverage.'],
  [['logging', 'monitor', 'audit trail', 'event log'], 'Screenshot of the logging / SIEM configuration and a sample of reviewed alerts.'],
  [['supplier', 'third part', 'third-part', 'vendor', 'outsourc', 'cloud'], 'Supplier register, a signed agreement with security clauses and the latest supplier review.'],
  [['physical', 'premises', 'visitor'], 'Photos or access-system export showing the physical control, and the visitor log.'],
  [['encrypt', 'cryptograph', 'key management'], 'Configuration screenshot showing encryption is enabled, and the key-management record.'],
  [['continuity', 'disaster', 'recovery'], 'Approved continuity / recovery plan and the latest test report.'],
  [['asset', 'inventory'], 'Export of the asset inventory showing owner and classification.'],
  [['risk'], 'Latest risk assessment report and the risk treatment plan with owners and dates.'],
  [['policy', 'policies', 'governance', 'strategy', 'roles and responsibilities'], 'Minutes or records showing the policy is communicated, acknowledged by staff and reviewed on schedule.'],
  [['data protection', 'personal data', 'privacy', 'classification'], 'Data inventory / classification register and a sample showing the handling rules applied.'],
  [['mobile', 'byod', 'endpoint', 'device', 'remote'], 'Endpoint / mobile-device management console export showing enrolled devices and enforced settings.'],
  [['develop', 'application', 'change', 'release', 'electronic service'], 'A recent change or release record showing security review, testing and approval.'],
];
function evidenceGuidance(control) {
  const title = (control.title || '').toLowerCase(); const body = (control.description || '').toLowerCase();
  let best = null; let bestScore = 0;
  for (const [words, text] of EVIDENCE_RULES) { const sc = hits(title, body, words); if (sc > bestScore) { best = text; bestScore = sc; } }
  return best || 'A screenshot, system export or signed record that shows the control operating in practice.';
}
async function discoverThreats(tenantId, profile, library, existingNames) {
  const settings = tenantSettings(tenantId);
  const sector = profile?.sector || '';
  const base = library.filter(t => t.sectors === '*' || t.sectors.split(',').includes(sector))
    .map(t => ({ name: t.name, category: t.category, description: t.description, source: 'library', rationale: t.sectors === '*' ? 'Common to all sectors' : `Relevant to the ${sector} sector` }));
  const llm = await llmJson(settings, 'You are a cyber threat intelligence analyst. List current, realistic threats for the organisation described.',
    `${profileText(profile)}\nMission: ${profile?.mission || ''}\nReturn a JSON array of up to 8 objects {"name","category","description","rationale"} that are specific to this organisation.`);
  const extra = Array.isArray(llm) ? llm.filter(t => t && t.name).map(t => ({ name: String(t.name), category: String(t.category || 'AI suggestion'), description: String(t.description || ''), source: 'ai', rationale: String(t.rationale || '') })) : [];
  const seen = new Set(existingNames.map(n => n.toLowerCase()));
  return [...extra, ...base].filter(t => { const k = t.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
module.exports = { suggestEffectiveness, suggestDepartment, evidenceGuidance, discoverThreats };
