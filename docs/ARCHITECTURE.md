# Cryptika GRC Hub — architecture and design decisions

Version 1.0 · 10 November 2026

## 1. What was asked, and from which sources

| Source | Used for |
|---|---|
| Three recorded walkthroughs (Arabic transcripts) | The authoritative description of behaviour: modules, screens, rules, what the AI may and may not do |
| BRD (Sept 2025) and BRD v1.0 (Nov 2025), epics, stories, backlog, sitemap | Cross-check of scope, role names, MVP cut, acceptance criteria |
| Replit exports 5–20 | Read for reference only (75 tables, 32,000 lines of server code). Nothing was reused |
| Task 8 and Task 9 Phase 5 workbooks | The reference database of the product |

Where the recordings and the BRD disagree, the recordings win, because they are later and more specific. The main
case: the BRD has an "implemented controls" catalogue that is mapped to frameworks; the recordings describe evidence
attached directly to framework controls and carried across frameworks by the map. The second model is built.

## 2. Why the earlier build stalled, and what is different here

The Replit build grew to roughly 75 tables, a React/TypeScript/Drizzle/Postgres toolchain and a separate workflow
service design before the core loop (policy clause → control → compliance %) was stable; each fix broke something
else and a contractor declined to take it over because of its size.

This build chooses the smallest architecture that delivers the described behaviour:

| Decision | Choice | Reason |
|---|---|---|
| Shape | One process: JSON API + static web client | One thing to start, back up and debug |
| Runtime | Node.js ≥ 22.13, **zero npm dependencies** | Nothing to install or break; uses built-in `node:http`, `node:sqlite`, `node:crypto` |
| Database | SQLite, one file, 46 tables | No database server to run for a pilot; SQL kept portable to PostgreSQL |
| Web client | Plain JavaScript modules, no build step | Edit a file, refresh the browser; no framework upgrades to chase |
| Workflow | A module with its own tables and a four-function interface, inside the same process | Gives the isolation the BRD wanted from a microservice without the operational cost; it can be split out later because nothing else touches its tables |
| Size | About 4,200 lines in total | One developer can read all of it in a day |

## 3. Modules

```
                       ┌──────────────────────────── Platform (Cryptika) ───────────────────────────┐
                       │ Organisations · Regulatory rules (country + sector → frameworks)           │
                       └────────────────────────────────────────────────────────────────────────────┘
 Governance            Risk                    Compliance               Audit               Administration
 ─ Company profile     ─ Assets                ─ Compliance position    ─ Question pool     ─ People
 ─ Laws & regulations  ─ Threats               ─ Gap assessments        ─ Audits            ─ Roles & permissions
 ─ Business processes  ─ Vulnerabilities       ─ Evidence requests      ─ Findings & CAPA   ─ Departments
 ─ Committees          ─ Threat mapping                                                     ─ Settings
 ─ Policies            ─ Risk register                                                      ─ Activity log
 ─ Frameworks & map    ─ Risk assessments

 Cross-cutting: Workflow engine (approval chains) · Compliance engine · Notifications · Evidence files · Reports
```

## 4. The control library

The two Phase 5 V3-B maps are loaded as they are (see `data/library/README.md`):

- `frameworks` — one per map column (17 cybersecurity, 10 privacy).
- `controls` — every ID that appears in a cell, with the title, verbatim description, record type and level taken
  from the row that control starts.
- `control_links` — two controls of different frameworks are linked when they share a Group or Single row. A link is
  **Direct** when a row with Mapping Confidence "Direct" joins it to that row's starting control; otherwise **Partial**.
- `map_rows` — every map row (Cryptika ID, row type, confidence, AI row description, notes, members) for display.

The loader reproduces the workbooks' own headline figures exactly (4,632 controls and 32,921 links; 2,432 and 4,784).
Library rows are shared by all organisations. An organisation can add its **own frameworks and its own mappings**;
those rows carry its tenant id and are invisible to everyone else.

## 5. The compliance engine (`server/services/coverage.js`)

Every assessable control is measured on two dimensions, as described in the recordings ("تشريع" and "تطبيق"):

| Dimension | Satisfied directly when | Entered by |
|---|---|---|
| Documentation | A **published** policy has a clause (or the policy itself) linked to the control | The policy author, who is responsible for the link being true |
| Implementation | Evidence for the control was judged **valid** in a gap assessment, or an audit question testing it was answered **Yes** (latest decision wins) | A person in the compliance or audit function — never the system |

For a control without evidence of its own, the engine looks one step across the map:

| Situation | Counts as |
|---|---|
| Own evidence | 100% |
| Linked by a Direct mapping to a satisfied control | 100% (inherited) |
| Linked by the organisation's own mapping | 100% (inherited; the organisation answers for it) |
| Linked only by Partial mappings | The organisation's *partial weight*, default 50% |
| Nothing | Gap |

Framework score = average of the documentation % and the implementation % over applicable controls. The same
calculation runs for frameworks that are not in scope, which is what powers "the day you adopt X you already stand at N%".

## 6. The workflow engine (`server/services/workflow.js`)

A chain is an ordered list of steps; each step belongs to a role. `start()` snapshots the chain into the instance,
so editing a chain never changes approvals already in flight. `act()` accepts approve / return only from someone
holding the current step's role (a tenant administrator may override, and the override is written into the history).
Modules register `onApproved` / `onRejected` callbacks; three record types use it today:

| Record | Default chain | On final approval |
|---|---|---|
| Policy | Technical review → Compliance review → Final approval (CISO) | Published, locked, everyone notified, previous version retired |
| Risk | Risk Manager confirmation | Enters the register |
| Risk assessment | Risk Manager review → Management sign-off | Marked completed |

Edit rule for policies, as described: the author edits a draft; while in review only the person whose turn it is may
edit; once published nobody can — a new version is started instead. Printing is offered only for published policies.

## 7. Risk method

- Cyber risks follow ISO 27001: a risk can only be registered where a **threat** meets a **vulnerability** on an
  **asset**. Threats are mapped to vulnerability categories (or single vulnerabilities); the register then proposes
  every unregistered combination. Business risks are free text and take free-text controls.
- The **risk register** is permanent; a **risk assessment** selects some or all registered risks for a stated purpose.
- Inherent score = likelihood (1–5) × impact (1–5).
- Residual score = inherent − 5 × Σ(control effectiveness, 0–5), never below 1 — or 0 when the treatment is *Avoid*.
  This is the rule given in the recording ("19 with effectiveness 2 leaves 9").
- Effectiveness can be suggested (built-in rules, or an AI model if configured). The suggestion is used only until the
  analyst enters a rating; the analyst's rating always wins and both are stored.

## 8. Multi-tenancy and security

| Concern | Mechanism |
|---|---|
| Isolation | Every organisation-owned table has `tenant_id`; every query filters on the session's tenant; ids sent by a client are checked to belong to the same organisation |
| Platform vs tenant administration | Separate consoles. Platform administrators manage organisations and regulatory rules and may enter a workspace (logged) |
| Permissions | Role → module → none / view / edit / manage. Menus show only what the role may open; the API enforces the same matrix |
| Passwords | scrypt with per-user salt; minimum 10 characters; sign-in throttled after 8 failures in 15 minutes |
| Sessions | Random 256-bit token in an HttpOnly, SameSite=Lax cookie; 12-hour life |
| Request forgery | State-changing calls require a custom header that a cross-site form cannot send |
| Output | The client builds the page from text nodes only; nothing received from the server is inserted as HTML |
| Evidence files | Stored outside the web root under random names; served only through a permission-checked download; executable types refused |
| Audit trail | `activity_log` records sign-ins, creates, updates, approvals, imports, reviews and every change of an organisation's access |
| Organisation access | `tenants.status` is active, read-only or suspended, with an optional end time (`access_until`) and a reason (`access_reason`). The state is checked on every request, not only at sign-in: read-only refuses every change, suspended refuses everything and ends the open sessions. A timed restriction lifts itself on the first request after its end time. `tenants.user_limit` caps active accounts. Platform administrators are not restricted |
| Shared access | `auth.origin()` tells a visitor at the host from one arriving over the network or through a tunnel. First-run passwords are accepted only at the host; the sign-in throttle counts by the visitor's real address; the cookie is `Secure` when the visitor arrived over HTTPS. See `docs/SHARING.md` |

Tested by `tests/smoke.js` (73 checks), including seven cross-organisation isolation checks, eleven access-state checks and five sharing checks.

### Company import (`server/services/importer.js`)

A company file is one JSON document: organisation, frameworks, vulnerability categories, assets, threats, vulnerabilities, risks and
assessments. `tools/ra_workbook_to_package.py` produces it from a Cryptika risk-assessment workbook. The importer creates the organisation
in one transaction, resolves control reference codes against the library (ECC codes against the 2024 edition first), and refuses the file
if any inherent or residual score it would display differs from the source. Three points of the model were adapted without changing figures:

- A workbook risk describes a threat against an asset category or a process, so it is registered with its threat and no single vulnerability;
  such a risk covers every vulnerability of that threat, and nothing is suggested twice.
- Impact may sit between two steps (for example 4.5). The value is stored as given and shown in the higher cell of the 5×5 matrix.
- The workbook divides inherent risk by an effectiveness factor. The same residual is reached here by one "existing controls" entry whose
  effectiveness is (inherent − residual) ÷ 5; the suggested controls are linked to the item, unrated, with the workbook's treatment plan.

## 9. Where AI is used

Only as advice that a person confirms, as required in the recordings:

| Feature | Built-in engine (offline) | With an AI model configured |
|---|---|---|
| Threat suggestions | Cryptika threat library filtered by sector | Adds organisation-specific threats |
| Control effectiveness | Keyword rules by control type | Model rates the control against the risk and profile |
| Department for an evidence request | Keyword scoring | (built-in only) |
| Evidence guidance | Keyword scoring | (built-in only) |

The model connection is any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, a local Ollama server). It is
implemented but **has not been exercised against a live model** in this build; without a key everything works on the
built-in engine. AI never decides whether evidence is valid or whether a policy clause really satisfies a control.

## 9a. Interface

- **Design system** (`web/css/app.css`): dark glass header on every page with a floating pill navigation, soft light surfaces below,
  Inter (bundled, so the interface works offline), 2.5rem / 1.5rem / 1rem corner radii, pill buttons whose main action carries a round icon,
  and a small motion system (below). Cryptika plum is the base of the dark gradient; emerald marks the organisation's own evidence and violet what
  it inherits through the map.
- **Motion**: a glass lens slides under the current item of the navigation, the page tabs and tab bars, and a fainter one follows the pointer;
  glass surfaces are lit from above and carry a highlight under the pointer; dialogs, menus and messages open and close with a short spring;
  pages change with a blur-dissolve where the browser offers view transitions. Figures count up once, table rows and matrix cells arrive in
  order, bars grow, and in the control map the ropes of the selected control flow. Everything is CSS plus about forty lines in `web/js/ui.js`,
  plays once per page, and is switched off for people who ask their system for reduced motion.
- **Mark**: a cut amethyst shaped as a C holding an emerald, drawn as inline SVG (`logo()` in `web/js/ui.js`) and reused as the browser icon.
  It is a placeholder for the official Cryptika logo, which can replace it in one place.
- **Charts** (`web/js/charts.js`): rings, donuts, bars and the 5×5 matrix are drawn as SVG by about seventy lines of code; there is no chart library.
- **Control map explorer** (`web/js/pages/map.js`): a small physics simulation lays out frameworks (grouped by region) and, one level down,
  a control with every equivalent control and the organisation's own records tied to it — policies, risks, evidence and audit questions.
  Nodes can be dragged, the view zoomed, a control's ropes pulled out with a double-click, and two controls tied together to create an
  own mapping. Two read-only endpoints feed it: `/api/graph/overview` and `/api/graph/control/:id`. The picture is capped at 320 nodes.
- **On-screen text** shows control wording without the provenance markers carried in the source maps (for example the note that an ISO
  sentence is Cryptika-authored). The stored data is unchanged; `cleanText()` in `web/js/ui.js` hides the markers at display time.

## 10. Decisions that need the owner's confirmation

| # | Decision taken | Why it matters | Where to change |
|---|---|---|---|
| 1 | A Partial mapping gives 50% credit | 36,407 of the 37,705 links are Partial, so this setting moves every inherited percentage | Administration → Settings (per organisation) |
| 2 | Every control has both a documentation and an implementation dimension | The recordings can also be read as "each control is one or the other"; no such classification exists in the maps | Would need a per-control flag |
| 3 | Several controls on one risk add up | Follows the single-control rule literally; three average controls can remove a risk entirely | `scoreItem()` in `server/routes/risk.js` |
| 4 | Country + sector → mandatory framework rules are a starter set written from general knowledge | They decide what a customer is told is mandatory; they need review by Cryptika against current regulation | Platform → Regulatory rules |
| 5 | The maps are shown with their own status: "draft, not approved" | Inherited compliance rests on them | Text in the Frameworks screen and the report |
| 6 | An audit "Yes" counts as implementation evidence | Stated in the recording; some may prefer audits to stay independent of the compliance score | `satisfied()` in `coverage.js` |
| 7 | A tenant administrator can decide an approval step on another role's behalf | Prevents a chain from blocking when someone is away; always logged as an override | `act()` in `workflow.js` |

## 11. Path to production

1. Run behind HTTPS (reverse proxy), `HOST=0.0.0.0`, `GRC_COOKIE_SECURE=1`; replace the first-run passwords.
2. Move to PostgreSQL when more than a handful of organisations write concurrently: the SQL is standard except
   `datetime('now')`, `INSERT OR IGNORE` and `ON CONFLICT`, all of which have direct PostgreSQL forms; only
   `server/db/index.js` talks to the driver.
3. Add email (SMTP) to `notify()` and a scheduled job for review dates and overdue items.
4. Add single sign-on when the first enterprise customer asks for it.
