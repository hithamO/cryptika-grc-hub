'use strict';
// Cryptika GRC Hub — application server (single process: JSON API + static web client).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Router, HttpError, buildContext, send } = require('./lib/http');
const { loadUser, tenantAccess, accessMessage } = require('./auth');
const { seedLibrary } = require('./db/seed-library');
const { seedReference } = require('./db/seed-defaults');
const { seedDemo } = require('./db/seed-demo');

console.log('Cryptika GRC Hub — starting');
seedLibrary(); seedReference(); seedDemo();

const router = new Router();
for (const m of ['core', 'library', 'governance', 'workflow', 'risk', 'compliance', 'audit', 'reports']) require('./routes/' + m)(router);
require('./services/importer').importPending();

const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8' };

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(WEB, p));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res);
  try {
    const hit = router.match(req.method, pathname.slice(4));
    if (!hit) throw new HttpError(404, 'Unknown API endpoint');
    // Cross-site request forgery guard: state-changing calls must carry the header our client sends.
    if (req.method !== 'GET' && req.headers['x-grc-client'] !== '1') throw new HttpError(400, 'Missing client header');
    const ctx = await buildContext(req, res, hit.params);
    ctx.user = loadUser(req);
    ctx.tenantId = ctx.user ? (ctx.user.is_platform_admin ? ctx.user.activeTenantId : ctx.user.tenant_id) : null;
    ctx.t = ctx.tenantId;
    if (ctx.user && ctx.tenantId && !ctx.user.is_platform_admin && pathname !== '/api/auth/logout') {
      const access = tenantAccess(ctx.tenantId);
      if (access.status === 'suspended') throw new HttpError(403, accessMessage(access));
      if (access.status === 'read_only' && req.method !== 'GET' && !['/api/notifications/read', '/api/me/password'].includes(pathname)) throw new HttpError(403, accessMessage(access) + ' Nothing can be changed for now.');
    }
    let result;
    for (const h of hit.route.handlers) { result = await h(ctx); if (res.writableEnded) return; }
    send(res, 200, result);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
    if (/UNIQUE constraint/.test(e.message)) return send(res, 409, { error: 'An item with the same identifier already exists' });
    if (/FOREIGN KEY constraint/.test(e.message)) return send(res, 409, { error: 'This item is used elsewhere and cannot be removed' });
    console.error(new Date().toISOString(), req.method, req.url, e);
    send(res, 500, { error: 'Unexpected server error. The details were written to the server log.' });
  }
});

// Listens on this computer only by default. Set HOST=0.0.0.0 to serve other machines (do that behind HTTPS).
const PORT = Number(process.env.PORT || 4000); const HOST = process.env.HOST || '127.0.0.1';
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other program or start with another port: set PORT=4100` : e); process.exit(1); });
server.listen(PORT, HOST, () => console.log(`  Ready: http://localhost:${PORT}`));
