'use strict';
// Deletes the database and uploaded evidence so the next start begins from a clean first run.
const fs = require('node:fs'); const path = require('node:path');
const dir = process.env.GRC_DATA_DIR || path.join(__dirname, '..', '..', 'data');
for (const f of ['grc.db', 'grc.db-wal', 'grc.db-shm']) fs.rmSync(path.join(dir, f), { force: true });
fs.rmSync(path.join(dir, 'uploads'), { recursive: true, force: true });
console.log('Data reset. Start the server to rebuild the library and first-run accounts.');
