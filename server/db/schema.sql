-- Cryptika GRC Hub — database schema (SQLite; written to stay portable to PostgreSQL).
-- Rule: every tenant-owned table carries tenant_id and is only ever queried through it.
-- Library tables (frameworks, controls, control_links, map_rows) are global when tenant_id IS NULL
-- and private to one tenant when tenant_id is set.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- ───────────────────────── Platform ─────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
  settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  description TEXT, level INTEGER NOT NULL DEFAULT 1, permissions TEXT NOT NULL DEFAULT '{}', is_system INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role_id INTEGER REFERENCES roles(id), department_id INTEGER REFERENCES departments(id),
  job_title TEXT, is_platform_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), tenant_id INTEGER, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (tenant_id INTEGER NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (tenant_id, key));
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY, tenant_id INTEGER, user_id INTEGER, action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER,
  detail TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_activity_tenant ON activity_log(tenant_id, id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read);

-- ───────────────────────── Control library (Phase 5 unified maps) ─────────────────────────
CREATE TABLE IF NOT EXISTS frameworks (
  id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), code TEXT NOT NULL, name TEXT NOT NULL,
  library TEXT NOT NULL,            -- CYS (Task 8), PDPL (Task 9) or CUSTOM
  region TEXT, description TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_framework_code ON frameworks(code, ifnull(tenant_id, 0));
CREATE TABLE IF NOT EXISTS controls (
  id INTEGER PRIMARY KEY, framework_id INTEGER NOT NULL REFERENCES frameworks(id), ref TEXT NOT NULL,
  title TEXT, description TEXT, family TEXT,
  record_type TEXT,                 -- OPERATIVE, PARENT_WITH_TEXT, HEADING_NO_TEXT, WITHDRAWN, NON_CATALOGUE_REFERENCE, REFERENCE
  assessable INTEGER NOT NULL DEFAULT 1,
  level TEXT,                       -- e.g. Jordan CICSC level
  applicable_role TEXT,             -- privacy map: Controller / Processor / …
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_control_ref ON controls(framework_id, ref);
CREATE TABLE IF NOT EXISTS control_links (
  a_id INTEGER NOT NULL REFERENCES controls(id), b_id INTEGER NOT NULL REFERENCES controls(id),
  confidence TEXT NOT NULL,         -- Direct | Partial | Tenant
  tenant_id INTEGER NOT NULL DEFAULT 0,   -- 0 = published Cryptika map; otherwise a tenant's own mapping
  PRIMARY KEY (a_id, b_id, tenant_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS map_rows (
  id INTEGER PRIMARY KEY, library TEXT NOT NULL, cryptika_id TEXT NOT NULL, start_control_id INTEGER NOT NULL REFERENCES controls(id),
  row_type TEXT, confidence TEXT, ai_description TEXT, notes TEXT, members TEXT NOT NULL  -- JSON {frameworkCode: [refs]}
);
CREATE INDEX IF NOT EXISTS ix_maprows_start ON map_rows(start_control_id);

-- ───────────────────────── Governance ─────────────────────────
CREATE TABLE IF NOT EXISTS company_profile (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id), legal_name TEXT, sector TEXT, country TEXT, size TEXT,
  description TEXT, mission TEXT, vision TEXT, business_objectives TEXT, cyber_objectives TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS regulatory_rules (
  id INTEGER PRIMARY KEY, country TEXT NOT NULL, sector TEXT NOT NULL, framework_code TEXT NOT NULL,
  requirement TEXT NOT NULL DEFAULT 'mandatory', basis TEXT
);
CREATE TABLE IF NOT EXISTS tenant_frameworks (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id), framework_id INTEGER NOT NULL REFERENCES frameworks(id),
  requirement TEXT NOT NULL DEFAULT 'voluntary',  -- mandatory | voluntary
  basis TEXT, added_by INTEGER, added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, framework_id)
);
CREATE TABLE IF NOT EXISTS business_processes (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, name TEXT NOT NULL, description TEXT,
  owner TEXT, department_id INTEGER, criticality INTEGER DEFAULT 3
);
CREATE TABLE IF NOT EXISTS committees (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, purpose TEXT, meeting_frequency TEXT
);
CREATE TABLE IF NOT EXISTS committee_members (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, committee_id INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  user_id INTEGER, name TEXT, title TEXT, committee_role TEXT
);
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT NOT NULL, title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'Policy', category TEXT, version TEXT NOT NULL DEFAULT '1.0', owner_id INTEGER,
  purpose TEXT, scope TEXT, summary TEXT, driver_framework_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | in_review | published | rejected | retired
  source TEXT NOT NULL DEFAULT 'authored', -- authored | imported
  supersedes_id INTEGER, review_date TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT, published_at TEXT
);
CREATE TABLE IF NOT EXISTS policy_driver_controls (policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE, control_id INTEGER NOT NULL, PRIMARY KEY (policy_id, control_id));
CREATE TABLE IF NOT EXISTS policy_clauses (
  id INTEGER PRIMARY KEY, policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE, number TEXT, text TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS clause_controls (clause_id INTEGER NOT NULL REFERENCES policy_clauses(id) ON DELETE CASCADE, control_id INTEGER NOT NULL, PRIMARY KEY (clause_id, control_id));

-- ───────────────────────── Workflow engine ─────────────────────────
CREATE TABLE IF NOT EXISTS workflow_templates (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, entity_type TEXT NOT NULL,
  description TEXT, active INTEGER NOT NULL DEFAULT 1, stages TEXT NOT NULL DEFAULT '[]'  -- JSON [{name, role_id}]
);
CREATE TABLE IF NOT EXISTS workflow_instances (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, template_id INTEGER, template_name TEXT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  title TEXT, stages TEXT NOT NULL, stage_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | approved | rejected
  started_by INTEGER, started_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_wfi_entity ON workflow_instances(tenant_id, entity_type, entity_id);
CREATE TABLE IF NOT EXISTS workflow_history (
  id INTEGER PRIMARY KEY, instance_id INTEGER NOT NULL REFERENCES workflow_instances(id), stage_index INTEGER, stage_name TEXT,
  action TEXT NOT NULL, user_id INTEGER, comment TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────────────────────── Risk ─────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, name TEXT NOT NULL, asset_type TEXT,
  ip_address TEXT, hostname TEXT, owner TEXT, custodian TEXT, department_id INTEGER, criticality INTEGER DEFAULT 3,
  description TEXT, source TEXT DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS threat_library (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, sectors TEXT);
CREATE TABLE IF NOT EXISTS vuln_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, keywords TEXT);
CREATE TABLE IF NOT EXISTS threats (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, name TEXT NOT NULL, category TEXT,
  description TEXT, source TEXT DEFAULT 'manual', rationale TEXT
);
CREATE TABLE IF NOT EXISTS vulnerabilities (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, asset_id INTEGER NOT NULL REFERENCES assets(id),
  title TEXT NOT NULL, severity TEXT, cvss REAL, cve TEXT, plugin_id TEXT, port TEXT, category_id INTEGER,
  description TEXT, solution TEXT, status TEXT DEFAULT 'open', source TEXT DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS threat_mappings (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, threat_id INTEGER NOT NULL REFERENCES threats(id) ON DELETE CASCADE,
  category_id INTEGER, vulnerability_id INTEGER
);
CREATE TABLE IF NOT EXISTS risks (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, title TEXT NOT NULL, description TEXT,
  risk_type TEXT NOT NULL DEFAULT 'cyber',  -- cyber | business
  category TEXT, threat_id INTEGER, vulnerability_id INTEGER, asset_id INTEGER, process_id INTEGER, owner_id INTEGER,
  department_id INTEGER, status TEXT NOT NULL DEFAULT 'registered',  -- pending | registered | rejected | closed
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS risk_assessments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, name TEXT NOT NULL, purpose TEXT, basis TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress', appetite INTEGER NOT NULL DEFAULT 6, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE TABLE IF NOT EXISTS risk_assessment_items (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, assessment_id INTEGER NOT NULL REFERENCES risk_assessments(id) ON DELETE CASCADE,
  risk_id INTEGER NOT NULL REFERENCES risks(id), likelihood INTEGER, impact INTEGER, notes TEXT,
  treatment TEXT, treatment_plan TEXT, treatment_owner TEXT, due_date TEXT
);
CREATE TABLE IF NOT EXISTS risk_item_controls (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, item_id INTEGER NOT NULL REFERENCES risk_assessment_items(id) ON DELETE CASCADE,
  control_id INTEGER, custom_control TEXT, effectiveness REAL, effectiveness_source TEXT, ai_suggestion REAL, ai_rationale TEXT
);

-- ───────────────────────── Compliance ─────────────────────────
CREATE TABLE IF NOT EXISTS gap_assessments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, name TEXT NOT NULL, framework_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | in_progress | completed
  due_date TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE TABLE IF NOT EXISTS gap_items (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, assessment_id INTEGER NOT NULL REFERENCES gap_assessments(id) ON DELETE CASCADE,
  control_id INTEGER NOT NULL, department_id INTEGER, suggested_department_id INTEGER, evidence_guidance TEXT,
  status TEXT NOT NULL DEFAULT 'unassigned',  -- unassigned | requested | submitted | valid | invalid | not_applicable
  response_note TEXT, reviewer_note TEXT, submitted_by INTEGER, submitted_at TEXT, reviewed_by INTEGER, reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_gapitems ON gap_items(assessment_id);
CREATE INDEX IF NOT EXISTS ix_gapitems_ctrl ON gap_items(tenant_id, control_id);
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, filename TEXT NOT NULL,
  stored_name TEXT NOT NULL, size INTEGER, mime TEXT, version INTEGER NOT NULL DEFAULT 1, note TEXT,
  uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_evidence_entity ON evidence(tenant_id, entity_type, entity_id);

-- ───────────────────────── Audit ─────────────────────────
CREATE TABLE IF NOT EXISTS audit_questions (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, topic TEXT, question TEXT NOT NULL, guidance TEXT, expected_evidence TEXT, auditee TEXT
);
CREATE TABLE IF NOT EXISTS audit_question_controls (question_id INTEGER NOT NULL REFERENCES audit_questions(id) ON DELETE CASCADE, control_id INTEGER NOT NULL, PRIMARY KEY (question_id, control_id));
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, title TEXT NOT NULL, objective TEXT, scope TEXT,
  framework_id INTEGER, status TEXT NOT NULL DEFAULT 'planned',  -- planned | fieldwork | reporting | closed
  lead_id INTEGER, start_date TEXT, end_date TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_sessions (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE, title TEXT NOT NULL,
  auditee TEXT, department_id INTEGER, session_date TEXT, start_time TEXT, duration_min INTEGER, location TEXT
);
CREATE TABLE IF NOT EXISTS audit_items (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE, question_id INTEGER,
  control_id INTEGER, topic TEXT, question TEXT NOT NULL, expected_evidence TEXT, auditee TEXT, session_id INTEGER,
  answer TEXT NOT NULL DEFAULT 'pending',   -- pending | yes | no | partial | na
  evidence_pending INTEGER NOT NULL DEFAULT 0, notes TEXT, answered_by INTEGER, answered_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_audititems ON audit_items(audit_id);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), ref TEXT, audit_id INTEGER, audit_item_id INTEGER, control_id INTEGER,
  title TEXT NOT NULL, description TEXT, severity TEXT DEFAULT 'Medium', finding_type TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | potential
  status TEXT NOT NULL DEFAULT 'open',   -- open | in_progress | resolved | closed
  owner TEXT, due_date TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS capas (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE, action TEXT NOT NULL,
  owner TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'open',  -- open | done | verified
  verification_note TEXT
);
