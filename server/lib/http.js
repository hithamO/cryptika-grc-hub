'use strict';
// Minimal HTTP router: no dependencies. Handlers receive a context and return a value (sent as JSON).
const { URL } = require('node:url');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (msg, extra) => new HttpError(400, msg, extra);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg);

class Router {
  constructor() { this.routes = []; }
  add(method, path, ...handlers) {
    const keys = [];
    const rx = new RegExp('^' + path.replace(/:[a-zA-Z_]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, rx, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(pathname);
      if (m) { const params = {}; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1])); return { route: r, params }; }
    }
    return null;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Upload is too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function buildContext(req, res, params) {
  const url = new URL(req.url, 'http://localhost');
  const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body: {}, raw: null, user: null, tenantId: null };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const type = (req.headers['content-type'] || '').split(';')[0];
    if (type === 'application/json') {
      const buf = await readBody(req, 20 * 1024 * 1024);
      try { ctx.body = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw bad('Request body is not valid JSON'); }
    } else {
      ctx.raw = await readBody(req, 60 * 1024 * 1024);
    }
  }
  return ctx;
}

function send(res, status, payload, headers = {}) {
  if (res.writableEnded) return;
  if (Buffer.isBuffer(payload)) { res.writeHead(status, headers); return res.end(payload); }
  const body = JSON.stringify(payload === undefined ? { ok: true } : payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

module.exports = { Router, HttpError, bad, notFound, forbidden, buildContext, send };
