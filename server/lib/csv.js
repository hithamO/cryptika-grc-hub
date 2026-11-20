'use strict';
// RFC 4180 CSV parser / writer (handles quoted fields, embedded newlines and doubled quotes).
function parse(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = []; let field = ''; let inQ = false; let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
// Parse into objects keyed by a normalised header (lower case, non-alphanumerics -> _).
function parseObjects(text) {
  const rows = parse(text).filter(r => r.some(c => c.trim() !== ''));
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(h => h.trim());
  const keys = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const records = rows.slice(1).map(r => { const o = {}; keys.forEach((k, i) => o[k] = (r[i] ?? '').trim()); return o; });
  return { headers, keys, records };
}
const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function stringify(headers, rows) {
  return '﻿' + [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n') + '\r\n';
}
module.exports = { parse, parseObjects, stringify };
