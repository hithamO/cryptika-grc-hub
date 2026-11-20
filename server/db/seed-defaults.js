'use strict';
// Reference data shipped with the product and the defaults every new tenant starts with.
const { all, get, run, insert, tx, meta } = require('./index');

const SECTORS = ['Banking', 'Insurance', 'Financial Services', 'Telecommunications', 'Government', 'Healthcare', 'Energy & Utilities', 'Oil & Gas',
  'Transportation', 'Technology', 'Retail & E-commerce', 'Education', 'Manufacturing', 'Other'];
const COUNTRIES = ['Jordan', 'Saudi Arabia', 'United Arab Emirates', 'European Union', 'Other'];

// Starter applicability rules: which frameworks the platform proposes as mandatory for a country + sector.
// '*' = every sector. These are Cryptika reference data and are editable under Platform → Regulatory rules.
const RULES = [
  ['Jordan', '*', 'Jordan PDPL', 'mandatory', 'Personal Data Protection Law No. 24 of 2023 applies to any organisation processing personal data in Jordan'],
  ['Jordan', '*', 'Jordan Security Instr.', 'mandatory', 'Security measures instructions issued under the Jordan PDPL'],
  ['Jordan', '*', 'Jordan NCSF', 'recommended', 'National Cybersecurity Framework (NCSC Jordan)'],
  ['Jordan', 'Banking', 'CBJ Banking', 'mandatory', 'Central Bank of Jordan cybersecurity framework for banks'],
  ['Jordan', 'Banking', 'Jordan NCSF', 'mandatory', 'Critical sector — NCSC Jordan'],
  ['Jordan', 'Banking', 'Jordan CICSC', 'mandatory', 'Critical infrastructure sector — NCSC Jordan'],
  ['Jordan', 'Insurance', 'CBJ Non-Banking', 'mandatory', 'Insurance is supervised by the Central Bank of Jordan (non-banking financial institutions)'],
  ['Jordan', 'Insurance', 'Jordan NCSF', 'mandatory', 'Critical sector — NCSC Jordan'],
  ['Jordan', 'Insurance', 'Jordan CICSC', 'mandatory', 'Critical infrastructure sector — NCSC Jordan'],
  ['Jordan', 'Financial Services', 'CBJ Non-Banking', 'mandatory', 'Non-banking financial institutions supervised by the Central Bank of Jordan'],
  ['Jordan', 'Financial Services', 'Jordan NCSF', 'mandatory', 'Critical sector — NCSC Jordan'],
  ['Jordan', 'Government', 'Jordan NCSF', 'mandatory', 'Government entities — NCSC Jordan'],
  ['Jordan', 'Government', 'Jordan CICSC', 'mandatory', 'Critical infrastructure sector — NCSC Jordan'],
  ['Jordan', 'Telecommunications', 'Jordan NCSF', 'mandatory', 'Critical sector — NCSC Jordan'],
  ['Jordan', 'Telecommunications', 'Jordan CICSC', 'mandatory', 'Critical infrastructure sector — NCSC Jordan'],
  ['Jordan', 'Energy & Utilities', 'Jordan NCSF', 'mandatory', 'Critical sector — NCSC Jordan'],
  ['Jordan', 'Energy & Utilities', 'Jordan CICSC', 'mandatory', 'Critical infrastructure sector — NCSC Jordan'],
  ['Jordan', 'Healthcare', 'Jordan NCSF', 'mandatory', 'Critical sector — NCSC Jordan'],
  ['Jordan', 'Healthcare', 'Jordan CICSC', 'mandatory', 'Critical infrastructure sector — NCSC Jordan'],
  ['Jordan', 'Transportation', 'Jordan CICSC', 'mandatory', 'Critical infrastructure sector — NCSC Jordan'],
  ['Saudi Arabia', '*', 'KSA PDPL', 'mandatory', 'Saudi Personal Data Protection Law'],
  ['Saudi Arabia', '*', 'KSA PDPL Impl. Reg.', 'mandatory', 'Implementing Regulation of the Saudi PDPL'],
  ['Saudi Arabia', '*', 'KSA Transfer Reg.', 'recommended', 'Applies when personal data is transferred outside the Kingdom'],
  ['Saudi Arabia', '*', 'NCA ECC-2:2024', 'recommended', 'NCA Essential Cybersecurity Controls'],
  ['Saudi Arabia', 'Banking', 'SAMA CSF', 'mandatory', 'Saudi Central Bank Cyber Security Framework'],
  ['Saudi Arabia', 'Insurance', 'SAMA CSF', 'mandatory', 'Saudi Central Bank Cyber Security Framework'],
  ['Saudi Arabia', 'Financial Services', 'SAMA CSF', 'mandatory', 'Saudi Central Bank Cyber Security Framework'],
  ['Saudi Arabia', 'Banking', 'NCA ECC-2:2024', 'mandatory', 'NCA Essential Cybersecurity Controls'],
  ['Saudi Arabia', 'Government', 'NCA ECC-2:2024', 'mandatory', 'NCA Essential Cybersecurity Controls — government entities'],
  ['Saudi Arabia', 'Government', 'NCA CSCC', 'recommended', 'Applies to entities operating critical systems'],
  ['Saudi Arabia', 'Energy & Utilities', 'NCA ECC-2:2024', 'mandatory', 'Critical national infrastructure'],
  ['Saudi Arabia', 'Energy & Utilities', 'NCA CSCC', 'mandatory', 'Critical systems'],
  ['Saudi Arabia', 'Telecommunications', 'CST CRF', 'mandatory', 'CST Cybersecurity Regulatory Framework for the ICT sector'],
  ['Saudi Arabia', 'Telecommunications', 'NCA ECC-2:2024', 'mandatory', 'Critical national infrastructure'],
  ['Saudi Arabia', 'Oil & Gas', 'NCA ECC-2:2024', 'mandatory', 'Critical national infrastructure'],
  ['Saudi Arabia', 'Oil & Gas', 'Aramco SACS-002', 'recommended', 'Required for Saudi Aramco third parties'],
  ['United Arab Emirates', '*', 'UAE PDPL', 'mandatory', 'Federal Decree-Law No. 45 of 2021'],
  ['United Arab Emirates', 'Government', 'Dubai ISR 3.1', 'mandatory', 'Dubai Government entities — DESC Information Security Regulation'],
  ['European Union', '*', 'EU GDPR', 'mandatory', 'Regulation (EU) 2016/679'],
  ['*', '*', 'ISO 27001:2022', 'recommended', 'International ISMS standard'],
  ['*', '*', 'NIST CSF 2.0', 'recommended', 'International cybersecurity framework'],
];

const THREATS = [
  ['Ransomware attack', 'Malware', 'Malicious software encrypts systems and data and demands payment for recovery.', '*'],
  ['Phishing and credential theft', 'Social engineering', 'Deceptive messages trick staff into disclosing credentials or running malicious content.', '*'],
  ['Business email compromise', 'Social engineering', 'An attacker impersonates an executive or supplier to redirect payments or obtain data.', '*'],
  ['Personal data breach', 'Data', 'Unauthorised disclosure of or access to customer or employee personal data.', '*'],
  ['Insider misuse of access', 'Insider', 'An employee or contractor abuses legitimate access to steal, alter or destroy information.', '*'],
  ['Privileged account abuse', 'Insider', 'Administrator-level accounts are misused or taken over.', '*'],
  ['Distributed denial of service', 'Availability', 'Online services are overwhelmed and become unavailable to customers.', 'Banking,Insurance,Financial Services,Telecommunications,Government,Retail & E-commerce'],
  ['Exploitation of unpatched systems', 'Technical', 'Known vulnerabilities in operating systems or applications are exploited before patches are applied.', '*'],
  ['Web application attack', 'Technical', 'Injection, broken access control or similar flaws in internet-facing applications are exploited.', '*'],
  ['Supply chain compromise', 'Third party', 'A supplier, software vendor or service provider is compromised and used as a path into the organisation.', '*'],
  ['Third-party service outage', 'Third party', 'A critical outsourced or cloud service becomes unavailable.', '*'],
  ['Cloud misconfiguration', 'Technical', 'Incorrectly configured cloud storage or services expose data or systems.', '*'],
  ['Malware via removable media', 'Malware', 'Infected USB or other removable media introduces malware to internal systems.', '*'],
  ['Loss or theft of devices', 'Physical', 'Laptops, phones or media holding company information are lost or stolen.', '*'],
  ['Unauthorised physical access', 'Physical', 'Intruders gain access to offices, data rooms or equipment.', '*'],
  ['Payment and claims fraud', 'Fraud', 'Systems or processes are manipulated to obtain fraudulent payments or claims.', 'Banking,Insurance,Financial Services,Retail & E-commerce'],
  ['Account takeover of customers', 'Fraud', 'Customer accounts are hijacked through credential stuffing or SIM-swap.', 'Banking,Insurance,Financial Services,Telecommunications,Retail & E-commerce'],
  ['API abuse', 'Technical', 'Exposed APIs are abused to extract data or bypass business rules.', 'Banking,Financial Services,Technology,Telecommunications,Retail & E-commerce'],
  ['Data leakage through shadow IT and AI tools', 'Data', 'Staff upload sensitive information to unapproved cloud or AI services.', '*'],
  ['Power or facility failure', 'Environmental', 'Loss of power, cooling or premises disrupts operations.', '*'],
  ['Industrial control system attack', 'Technical', 'Operational technology is manipulated or disrupted.', 'Energy & Utilities,Oil & Gas,Manufacturing,Transportation'],
  ['Medical data exposure', 'Data', 'Patient records are disclosed or altered.', 'Healthcare'],
];

const VULN_CATEGORIES = [
  ['Missing patches and outdated software', 'Security updates not applied; unsupported or end-of-life software.', 'patch,update,outdated,unsupported,end of life,eol,security update,ms1,kb,upgrade,version detection,multiple vulnerabilities'],
  ['Cryptographic failures', 'Weak or missing encryption, weak ciphers and protocols, certificate problems.', 'ssl,tls,cipher,certificate,crypt,sha-1,md5,rc4,sweet32,poodle,weak hash,self-signed,diffie'],
  ['Authentication and credential weaknesses', 'Default or weak passwords, missing MFA, weak session handling.', 'password,default credential,default account,authentication,brute,login,anonymous,null session,snmp community'],
  ['Broken access control', 'Missing or bypassable authorisation; excessive permissions.', 'access control,privilege,authorization,permission,unauthenticated access,traversal,idor,world writable'],
  ['Injection', 'SQL, command, LDAP or script injection flaws.', 'injection,sqli,xss,cross-site scripting,command execution,remote code execution,rce,deserialization'],
  ['Security misconfiguration', 'Insecure default settings, unnecessary services, missing hardening.', 'misconfig,configuration,enabled,exposed,directory listing,header,hardening,smb signing,open relay,debug'],
  ['Information disclosure', 'Systems reveal sensitive technical or business information.', 'disclosure,information leak,banner,version disclosure,enumeration,internal ip'],
  ['Denial of service', 'Flaws that allow a service to be crashed or exhausted.', 'denial of service,dos,resource exhaustion,crash'],
  ['Logging and monitoring gaps', 'Insufficient logging, alerting or audit trails.', 'logging,audit,monitoring'],
  ['Insecure design and other', 'Design weaknesses and findings that fit no other category.', ''],
];

const DEPARTMENTS = ['Information Security', 'Information Technology', 'Compliance', 'Risk Management', 'Internal Audit', 'Human Resources', 'Legal', 'Operations', 'Finance', 'Executive Management'];

const P = (o) => JSON.stringify({ governance: 'view', policies: 'view', frameworks: 'view', workflow: 'view', risk: 'none', compliance: 'none', audit: 'none', reports: 'none', admin: 'none', ...o });
// [name, approval level, description, permissions]
const ROLES = [
  ['Tenant Administrator', 9, 'Full control of the organisation workspace', P({ governance: 'manage', policies: 'manage', frameworks: 'manage', workflow: 'manage', risk: 'manage', compliance: 'manage', audit: 'manage', reports: 'manage', admin: 'manage' })],
  ['CISO', 5, 'Final approver; oversight of all modules', P({ governance: 'manage', policies: 'manage', frameworks: 'manage', workflow: 'manage', risk: 'manage', compliance: 'manage', audit: 'view', reports: 'manage' })],
  ['Compliance Manager', 4, 'Owns frameworks, gap assessments and evidence validation', P({ governance: 'edit', policies: 'manage', frameworks: 'manage', workflow: 'edit', risk: 'view', compliance: 'manage', audit: 'view', reports: 'manage' })],
  ['Risk Manager', 4, 'Approves registered risks and runs risk assessments', P({ governance: 'view', policies: 'view', risk: 'manage', compliance: 'view', reports: 'edit' })],
  ['Internal Auditor', 3, 'Plans and conducts audits; raises findings', P({ governance: 'view', policies: 'view', risk: 'view', compliance: 'view', audit: 'manage', reports: 'edit' })],
  ['Technical Reviewer', 2, 'Reviews the technical content of policies', P({ policies: 'edit', risk: 'view', compliance: 'view' })],
  ['Compliance Officer', 2, 'Maintains policies and follows up evidence', P({ governance: 'edit', policies: 'edit', compliance: 'edit', reports: 'view' })],
  ['Risk Officer', 2, 'Registers risks, assets, threats and vulnerabilities', P({ risk: 'edit', reports: 'view' })],
  ['Policy Writer', 1, 'Drafts policies and procedures', P({ policies: 'edit' })],
  ['Control Owner', 1, 'Department representative who provides evidence', P({ compliance: 'view', risk: 'view' })],
  ['Viewer', 0, 'Read-only access', P({ risk: 'view', compliance: 'view', audit: 'view', reports: 'view' })],
];

function seedReference() {
  if (meta.get('reference_version')) return;
  tx(() => {
    for (const r of RULES) insert('regulatory_rules', { country: r[0], sector: r[1], framework_code: r[2], requirement: r[3], basis: r[4] });
    for (const t of THREATS) insert('threat_library', { name: t[0], category: t[1], description: t[2], sectors: t[3] });
    for (const v of VULN_CATEGORIES) insert('vuln_categories', { name: v[0], description: v[1], keywords: v[2] });
    meta.set('reference_version', '1');
  });
}

const DEFAULT_SETTINGS = {
  partial_weight: 0.5,       // how much a control inherited through a Partial mapping counts (0..1)
  risk_appetite: 6,          // scores at or below this are acceptable
  ai_provider: 'builtin',    // builtin | openai-compatible
  ai_base_url: '', ai_model: '', ai_api_key: '',
};

// Creates roles, departments and the standard approval chains for a new tenant.
function provisionTenant(name, slug) {
  return tx(() => {
    const tenantId = insert('tenants', { name, slug, settings: JSON.stringify(DEFAULT_SETTINGS) });
    const roleId = {};
    for (const [n, level, description, permissions] of ROLES) roleId[n] = insert('roles', { tenant_id: tenantId, name: n, level, description, permissions, is_system: 1 });
    for (const d of DEPARTMENTS) insert('departments', { tenant_id: tenantId, name: d });
    const st = (...names) => JSON.stringify(names.map(([stage, role]) => ({ name: stage, role_id: roleId[role] })));
    insert('workflow_templates', { tenant_id: tenantId, name: 'Policy approval', entity_type: 'policy', description: 'Approval chain every policy follows before it is published',
      stages: st(['Technical review', 'Technical Reviewer'], ['Compliance review', 'Compliance Manager'], ['Final approval', 'CISO']) });
    insert('workflow_templates', { tenant_id: tenantId, name: 'Risk registration', entity_type: 'risk', description: 'A newly raised risk is confirmed by the Risk Manager before it enters the register',
      stages: st(['Risk Manager confirmation', 'Risk Manager']) });
    insert('workflow_templates', { tenant_id: tenantId, name: 'Risk assessment sign-off', entity_type: 'risk_assessment', description: 'Completed risk assessments are signed off by management',
      stages: st(['Risk Manager review', 'Risk Manager'], ['Management sign-off', 'CISO']) });
    insert('company_profile', { tenant_id: tenantId, legal_name: name });
    return { tenantId, roleId };
  });
}

module.exports = { seedReference, provisionTenant, SECTORS, COUNTRIES, DEFAULT_SETTINGS, ROLES };
