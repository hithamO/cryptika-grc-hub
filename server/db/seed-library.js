'use strict';
// Loads the Cryptika Phase 5 unified control maps (Task 8 cybersecurity, Task 9 privacy) into the library tables.
// Source: data/library/*.csv.gz — value-for-value copies of the "Unified Control Map" sheets (version B: every
// framework starts its own rows). Nothing is re-interpreted: frameworks are the map columns, controls are the IDs
// in the cells, and a link exists between two controls of different frameworks whenever they share a Group/Single row.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const csv = require('../lib/csv');
const { all, get, run, insert, tx, meta } = require('./index');

const LIB_DIR = path.join(__dirname, '..', '..', 'data', 'library');
const EMPTY = new Set(['', 'No Mapping Available', '—']);

const MAPS = [
  {
    library: 'CYS', file: 'task8_cys_unified_map_v3b_all_starts.map.csv.gz', startCol: 'Starting Control', attrCols: ['CICSC Level'],
    frameworks: [ // [map column, region, full name]
      ['NIST SP 800-53 R5', 'International', 'NIST SP 800-53 Rev. 5'], ['NIST CSF 2.0', 'International', 'NIST Cybersecurity Framework 2.0'],
      ['NIST CSF 1.1', 'International', 'NIST Cybersecurity Framework v1.1'], ['ISO 27001:2013', 'International', 'ISO/IEC 27001:2013 Annex A'],
      ['ISO 27001:2022', 'International', 'ISO/IEC 27001:2022 (Annex A + clauses 4–10)'],
      ['NCA ECC-1:2018', 'Saudi Arabia', 'Saudi NCA Essential Cybersecurity Controls ECC-1:2018'], ['NCA ECC-2:2024', 'Saudi Arabia', 'Saudi NCA Essential Cybersecurity Controls ECC-2:2024'],
      ['NCA CSCC', 'Saudi Arabia', 'Saudi NCA Critical Systems Cybersecurity Controls'], ['SAMA CSF', 'Saudi Arabia', 'SAMA Cyber Security Framework v1.0'],
      ['CST CRF', 'Saudi Arabia', 'Saudi CST Cybersecurity Regulatory Framework'], ['Aramco SACS-002', 'Saudi Arabia', 'Saudi Aramco SACS-002 Third-Party Cybersecurity Standard'],
      ['Aramco SACS-210', 'Saudi Arabia', 'Saudi Aramco SACS-210 Third-Party Cybersecurity Standard'],
      ['Jordan CICSC', 'Jordan', 'Jordan Critical Infrastructure Cybersecurity Controls'], ['Jordan NCSF', 'Jordan', 'Jordan National Cybersecurity Framework'],
      ['CBJ Banking', 'Jordan', 'Central Bank of Jordan — Banking Sector v1.0'], ['CBJ Non-Banking', 'Jordan', 'CBJ / Jo-FinCERT Non-Banking Catalogue v1.0'],
      ['Dubai ISR 3.1', 'UAE', 'Dubai DESC Information Security Regulation v3.1'],
    ],
    startAlias: {},
  },
  {
    library: 'PDPL', file: 'task9_pdpl_unified_map_v3b_every_framework.map.csv.gz', startCol: 'Starting Provision', attrCols: [],
    frameworks: [
      ['ISO 27701:2025', 'International', 'ISO/IEC 27701:2025'], ['ISO 27701:2019', 'International', 'ISO/IEC 27701:2019'], ['ISO 29100:2024', 'International', 'ISO/IEC 29100:2024'],
      ['EU GDPR', 'European Union', 'EU GDPR (Regulation 2016/679)'], ['KSA PDPL', 'Saudi Arabia', 'Saudi Personal Data Protection Law'],
      ['KSA PDPL Impl. Reg.', 'Saudi Arabia', 'Saudi PDPL Implementing Regulation'], ['KSA Transfer Reg.', 'Saudi Arabia', 'Saudi Regulation on Personal Data Transfer outside the Kingdom'],
      ['Jordan PDPL', 'Jordan', 'Jordan Personal Data Protection Law No. 24 of 2023'], ['Jordan Security Instr.', 'Jordan', 'Jordan Technical and Organisational Security Measures Instructions 2025'],
      ['UAE PDPL', 'UAE', 'UAE Federal Decree-Law No. 45 of 2021'],
    ],
    // "Starting Framework" names used in the Task 9 sheet -> map column names
    startAlias: { 'ISO/IEC 27701:2025': 'ISO 27701:2025', 'ISO/IEC 27701:2019': 'ISO 27701:2019', 'ISO/IEC 29100:2024': 'ISO 29100:2024', 'Saudi PDPL': 'KSA PDPL',
      'Saudi PDPL Implementing Regulation': 'KSA PDPL Impl. Reg.', 'Saudi Transfer Regulation': 'KSA Transfer Reg.', 'Jordan Security Measures Instructions': 'Jordan Security Instr.' },
  },
];

// Grouping label derived from the control ID only (used for filters in the UI).
function family(ref) {
  const r = ref.replace(/\s*\[article\]$/, '');
  let m;
  if ((m = /^A\.(\d+)/.exec(r))) return 'A.' + m[1];
  if ((m = /^([A-Za-z]{2,})[.\-]/.exec(r))) return m[1];
  if ((m = /^(\d+)[.\-(]/.exec(r))) return m[1];
  if ((m = /^([A-Za-z]+)\d/.exec(r))) return m[1];
  return r.split(/[.\-( ]/)[0];
}
const split = cell => EMPTY.has(cell) ? [] : cell.split(';').map(s => s.trim()).filter(Boolean);

function loadMap(def) {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(LIB_DIR, def.file))).toString('utf8');
  const rows = csv.parse(text);
  const hdr = rows[0]; const col = Object.fromEntries(hdr.map((h, i) => [h, i]));
  const fwId = {}; const ctrlId = new Map(); // "fw\u0001ref" -> id
  def.frameworks.forEach(([code, region, name], i) => {
    fwId[code] = insert('frameworks', { tenant_id: null, code, name, library: def.library, region, sort: i });
  });
  const key = (fw, ref) => fw + '\u0001' + ref;
  let sort = 0;
  const ensure = (fw, ref) => {
    const k = key(fw, ref); let id = ctrlId.get(k);
    if (!id) { id = insert('controls', { framework_id: fwId[fw], ref, family: family(ref), record_type: null, assessable: 1, sort: sort++ }); ctrlId.set(k, id); }
    return id;
  };
  const links = new Map(); // "a|b" (a<b) -> 'Direct' | 'Partial'
  const setLink = (a, b, direct) => {
    const k = a < b ? a + '|' + b : b + '|' + a;
    if (direct) links.set(k, 'Direct'); else if (!links.has(k)) links.set(k, 'Partial');
  };
  const described = new Set();
  let nRows = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r[col['Cryptika ID']]) continue;
    const startFwRaw = r[col['Starting Framework']]; const startFw = def.startAlias[startFwRaw] || startFwRaw;
    const startRef = r[col[def.startCol]];
    if (!fwId[startFw]) throw new Error(`Unknown starting framework "${startFwRaw}" on ${r[col['Cryptika ID']]}`);
    const members = {}; const ids = [];
    for (const [code] of def.frameworks) {
      const refs = split(r[col[code]]); if (!refs.length) continue;
      members[code] = refs; for (const ref of refs) ids.push([code, ensure(code, ref)]);
    }
    const startId = ensure(startFw, startRef);
    const rowType = r[col['Row Type']]; const conf = r[col['Mapping Confidence']];
    const recordType = col['Record Type'] != null ? r[col['Record Type']] : (rowType === 'Reference' ? 'REFERENCE' : 'OPERATIVE');
    if (!described.has(startId)) {
      described.add(startId);
      // CICSC level: the level list is positional with the CICSC cell
      let level = null;
      if (startFw === 'Jordan CICSC' && col['CICSC Level'] != null) {
        const pos = split(r[col['Jordan CICSC']]).indexOf(startRef); const lv = split(r[col['CICSC Level']]);
        if (pos >= 0 && lv[pos]) level = lv[pos];
      }
      run('UPDATE controls SET title=?, description=?, record_type=?, applicable_role=?, level=? WHERE id=?',
        r[col['Control Title']] || null, r[col['Control Description']] || null, recordType,
        col['Applicable Role'] != null ? r[col['Applicable Role']] : null, level, startId);
    }
    // Links: every pair of controls from different frameworks on a Group/Single row.
    // A pair is "Direct" when a Direct row links it to that row's starting control.
    if (!/^(Standalone|Reference)/.test(rowType)) {
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        if (ids[a][0] === ids[b][0]) continue;
        const touchesStart = ids[a][1] === startId || ids[b][1] === startId;
        setLink(ids[a][1], ids[b][1], conf === 'Direct' && touchesStart);
      }
    }
    insert('map_rows', { library: def.library, cryptika_id: r[col['Cryptika ID']], start_control_id: startId, row_type: rowType, confidence: conf,
      ai_description: r[col['AI Row Description']] || null, notes: r[col['Mapping Notes']] || null, members: JSON.stringify(members) });
    nRows++;
  }
  for (const [k, conf] of links) {
    const [a, b] = k.split('|').map(Number);
    run('INSERT INTO control_links (a_id,b_id,confidence,tenant_id) VALUES (?,?,?,0)', a, b, conf);
    run('INSERT INTO control_links (a_id,b_id,confidence,tenant_id) VALUES (?,?,?,0)', b, a, conf);
  }
  // Display order: natural order of the control IDs within each framework (4.1 … 10.2, A.5.1 … A.8.34, AC-1, AC-2, AC-2(1) …)
  for (const [code] of def.frameworks) {
    const refs = all('SELECT id, ref FROM controls WHERE framework_id=?', fwId[code]).sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
    refs.forEach((c, i) => run('UPDATE controls SET sort=? WHERE id=?', i, c.id));
  }
  // Not assessable: headings without text, withdrawn controls, mapping-source tokens and privacy reference provisions.
  run(`UPDATE controls SET assessable=0 WHERE framework_id IN (SELECT id FROM frameworks WHERE library=? AND tenant_id IS NULL)
       AND (record_type IN ('HEADING_NO_TEXT','WITHDRAWN','NON_CATALOGUE_REFERENCE','REFERENCE') OR record_type IS NULL)`, def.library);
  if (def.library === 'PDPL') {
    // Privacy map has no Record Type column: a provision is a reference provision (Part B) when it starts a
    // Reference row, or when it never starts a row and is only cited by other rows.
    run(`UPDATE controls SET assessable=1, record_type='OPERATIVE' WHERE framework_id IN (SELECT id FROM frameworks WHERE library='PDPL')`);
    run(`UPDATE controls SET assessable=0, record_type='REFERENCE' WHERE framework_id IN (SELECT id FROM frameworks WHERE library='PDPL')
         AND (id IN (SELECT start_control_id FROM map_rows WHERE library='PDPL' AND row_type LIKE 'Reference%')
              OR id NOT IN (SELECT start_control_id FROM map_rows WHERE library='PDPL'))`);
  }
  return { library: def.library, rows: nRows, controls: ctrlId.size, links: links.size };
}

function seedLibrary() {
  if (meta.get('library_version')) return null;
  const t0 = Date.now();
  const out = tx(() => MAPS.map(loadMap));
  meta.set('library_version', 'phase5-v3b');
  meta.set('library_stats', JSON.stringify(out));
  console.log(`  Control library loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, out.map(o => `${o.library}: ${o.rows} map rows, ${o.controls} controls, ${o.links} links`).join(' | '));
  return out;
}
module.exports = { seedLibrary };
if (require.main === module) seedLibrary();
