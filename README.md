# Cryptika GRC Hub

A multi-tenant governance, risk, compliance and audit platform built around the Cryptika unified control maps
(Task 8 cybersecurity and Task 9 privacy, Phase 5 V3). Comply with one control and the map carries it to the
equivalent controls of every other framework.

## Start it

1. Install **Node.js 22.13 or newer** (LTS) from https://nodejs.org — nothing else is needed; there is no `npm install`.
2. Windows: double-click **`start.bat`**. macOS / Linux: `./start.sh`.
3. Open http://localhost:4000 (the Windows script opens it for you).

The first start creates `data/grc.db`, loads the control library (about four seconds) and creates the accounts below.

## First-run accounts

All use the password **`Cryptika#2026`**. Change them, or disable the demo people, before real use.

| Sign in as | Role | What to try |  
|---|---|---|
| `admin@cryptika.local` | Platform administrator (Cryptika) | Create organisations, edit the regulatory rules, open any workspace |
| `admin@almanara.demo` | Tenant Administrator | People, roles, departments, settings, approval chains |
| `ciso@almanara.demo` | CISO | Final approval step of policies |
| `compliance@almanara.demo` | Compliance Manager | Compliance position, gap assessment, evidence review |
| `risk@almanara.demo` | Risk Manager | Register, threat mapping, risk assessment |
| `auditor@almanara.demo` | Internal Auditor | Question pool, audits, findings |
| `reviewer@almanara.demo` | Technical Reviewer | First approval step — one policy is waiting |
| `writer@almanara.demo` | Policy Writer | Write a policy, link clauses to controls, send for approval |
| `it@almanara.demo` | Control Owner (IT) | Evidence requests from the gap assessment |
| `hr@almanara.demo` | Control Owner (HR) | Evidence requests from the gap assessment |

"Al Manara Insurance (Demo)" is invented data for demonstration. To start without it, set `GRC_NO_DEMO=1`
before the very first start (only the platform administrator is created).

## Share it

Double-click **`share.bat`** and choose the office network or a temporary secure link. Nothing is copied: people open the
system on this computer with their own sign-in. Read [`docs/SHARING.md`](docs/SHARING.md) first — it covers accounts,
passwords and client data.

## Organisations

| Task | Where |
|---|---|
| Add an empty organisation | *Platform → Organisations → Add organisation* |
| Add a company from a risk-assessment workbook | Convert it once with `python tools/ra_workbook_to_package.py "<workbook>.xlsx" data/imports/<name>.json --name "<Company>" --sector <Sector> --country "<Country>"` (needs Python with `openpyxl`). Files in `data/imports/` load at the next start; *Import a company file* loads one straight away. |
| Make an organisation read-only or suspend it | *Platform → Organisations → Manage access*: choose the state, how long it lasts and the reason people see. Access returns by itself when the time is up. |
| Limit how many people an organisation may have | Same screen, *People allowed* |
| Sign everyone out | Same screen, *Sign everyone out* |
| Give a colleague access to every organisation | *Platform → Platform team → Add person* |

Company files in `data/imports/` hold client data. They stay on the computer that runs the system and are never committed
to the code repository (`.gitignore` keeps them out). The importer checks every inherent and residual score against the
workbook. See the note in `docs/SHARING.md`.

## A ten-minute tour

0. **Home** shows the position in charts: overall compliance ring, a ring per framework, the risk heat map and work in motion.
   **Control map** is the interactive web of frameworks and controls: click a framework, open a control, double-click to pull out
   its ropes, and tie two controls together to create your own mapping.

1. **Writer** → Policies → *Write a policy* → add a clause → *Link controls* → save → *Send for approval*.
2. **Reviewer**, then **Compliance**, then **CISO** → *Approvals waiting for me* → approve. The policy becomes published and locked.
3. **Compliance** → *Compliance position*: the control is now documented, and so are its equivalents in the other frameworks, including ones not in scope.
4. **Compliance** → Gap assessments → open GAP-0001 → *Review* submitted evidence. **IT** → *Evidence requests* → attach a file and submit.
5. **Risk** → Threat mapping → Risk register (suggested risks) → Risk assessments → open RA-0001: set effectiveness and watch the residual score.
6. **Auditor** → Audits → *New audit* against ISO 27001:2022 → Fieldwork → answer "No": a finding is raised.
7. **Platform admin** → Organisations → *Add organisation*, then sign in as its administrator: an empty, isolated workspace.

## Folder layout

```
start.bat / start.sh     start the server
share.bat                share it on the office network or through a temporary secure link
server/                  application server (Node.js, no dependencies)
  index.js               HTTP entry point
  auth.js                sessions, roles, permissions
  db/                    schema.sql, data access, seeders
  services/              workflow engine, compliance engine, suggestions, company import
  routes/                one file per module
web/                     browser client (plain JavaScript modules, no build step)
  css/app.css            the design system (glass on plum-black, light surfaces, Inter)
  js/charts.js           hand-drawn SVG charts
  js/pages/map.js        the control map explorer
  fonts/                 Inter (bundled, SIL Open Font License)
data/library/            the Phase 5 maps as CSV (gzip) — the product's reference database
data/imports/            company files loaded at start-up
data/grc.db              created at first start (all organisation data)
data/uploads/            evidence files
docs/                    ARCHITECTURE.md, MVP_SCOPE.md, SHARING.md
tools/                   workbook-to-company-file converter
tests/smoke.js           end-to-end API test:  node tests/smoke.js
```

## Operating notes

| Task | How |
|---|---|
| Use another port | `set PORT=4100` (Windows) or `PORT=4100 ./start.sh` |
| Let other computers connect | `share.bat`, or see `docs/SHARING.md` for a server installation |
| Back up | Stop the server; copy `data/grc.db` and `data/uploads/` |
| Start again from zero | `node server/db/reset.js` (deletes all organisation data) |
| Run the tests | `node tests/smoke.js` — uses a temporary database, never your data |
| Keep data elsewhere | `set GRC_DATA_DIR=D:\grc-data` |

Imports accept CSV (in Excel: *Save as → CSV UTF-8*): assets, vulnerabilities (Nessus CSV export or the simple
template), own frameworks with mappings, and the audit question pool. Templates download from the relevant screens.
