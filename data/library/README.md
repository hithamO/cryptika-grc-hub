# Control library — source data

These files are value-for-value copies of the "Unified Control Map" and "Overview" sheets of the four Phase 5
workbooks, converted from .xlsx to CSV (UTF-8, gzip). No cell was changed; every cell in the source sheets is text.
`MANIFEST.json` records the source file name, row count and SHA-256 of each CSV.

| File | Source workbook | Rows | Loaded into the database |
|---|---|---|---|
| `task8_cys_unified_map_v3b_all_starts.map.csv.gz` | TASK_8_Cryptika_Phase5_Unified_Map_V3_B_All_Starts.xlsx | 22,453 | Yes |
| `task9_pdpl_unified_map_v3b_every_framework.map.csv.gz` | TASK_9_PDPL_Phase5_Unified_Control_Map_V3_B_Every_Framework.xlsx | 3,900 | Yes |
| `task8_cys_unified_map_v3a_nist_starts.map.csv.gz` | TASK_8_Cryptika_Phase5_Unified_Map_V3_A_NIST_Starts.xlsx | 19,983 | No — same 32,921 links as V3-B, arranged differently |
| `task9_pdpl_unified_map_v3a_gdpr_first.map.csv.gz` | TASK_9_PDPL_Phase5_Unified_Control_Map_V3_A_GDPR_First.xlsx | 2,948 | No — same 4,784 links as Version B |

Version B is loaded because every control starts its own rows there, so each control's page can show its rows.

What the loader (`server/db/seed-library.js`) derives, checked against the workbooks' own Overview figures:

| | Task 8 cybersecurity | Task 9 privacy |
|---|---|---|
| Frameworks (map columns) | 17 | 10 |
| Controls / provisions | 4,632 | 2,432 (2,210 catalogue + 108 whole-article IDs + 114 reference IDs) |
| Assessable | 4,106 (OPERATIVE + PARENT_WITH_TEXT) | 1,544 (those that do not start a Reference row) |
| Unique links | 32,921 | 4,784 |
| Direct / Partial links | 1,298 Direct and 36,407 Partial across both maps | |

To load a newer version of the maps: convert the workbook the same way, replace the file, run `node server/db/reset.js`
and start the server. (Replacing the library in place without resetting organisation data is listed in MVP_SCOPE.md.)
