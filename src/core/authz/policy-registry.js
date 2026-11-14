// src/core/authz/policy-registry.js
// The CI test needs every route declared in src/routes/*.js, with its
// middleware chain and policy tag. Loading the routers under Jest fails
// because their handlers pull in ESM-only packages (file-type, expo-server-sdk,
// parse5 via isomorphic-dompurify) that Jest 29 cannot resolve without Babel.
// The test walks the source text instead.
//
// analyzeRouteFiles(files) returns an array of:
//   { method, path, chainNames: string[], policy: null | {type, ...} }
//
// chainNames are the middleware identifiers between the path and the handler.
// Today no route carries a .policy tag (no route is decorated with
// requireCapability or publicRoute yet), so policy is always null. When a
// route is decorated - for example:
//
//   router.get('/orders', authenticatePharmacy, requireCapability('orders.view'), handler)
//
// chainNames will contain 'requireCapability' and policy will be null
// until the analyzer learns the tag from the JS AST. The FND-04e follow-up
// upgrades this to a real parser; today's analyzer is intentionally
// conservative and produces null policy for every route. The grandfather
// snapshot is the state of the world until that follow-up.
//
// Regex chosen for the actual codebase style - every route is declared as
// a single call to router.<verb>('<path>' with the middleware chain
// following, and a handler at the end.

const fs = require('node:fs');

const ROUTE_RE = /router\.(get|post|put|patch|delete|all)\s*\(\s*(['"])([^'"]+)\2([\s\S]*?)(?=router\.(?:get|post|put|patch|delete|all)\s*\(|^\}\s*|$)/gm;

const MIDDLEWARE_RE = /\b([A-Za-z_$][\w$]*)\s*(?:\([^)]*\))?\s*,/g;

function extractChain(rest) {
  // `rest` is everything after the path literal up to the next route
  // declaration. Take the leading identifier list, stop at `async` or
  // `(req` or `function` (the handler).
  const out = [];
  // Cut at the first handler-like token
  const cut = rest.search(/\basync\b|\bfunction\b|\(\s*req\b/);
  const head = cut >= 0 ? rest.slice(0, cut) : rest;
  let m;
  MIDDLEWARE_RE.lastIndex = 0;
  while ((m = MIDDLEWARE_RE.exec(head)) !== null) {
    const name = m[1];
    if (name === 'req' || name === 'res' || name === 'next') continue;
    out.push(name);
  }
  return out;
}

function analyzeFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  ROUTE_RE.lastIndex = 0;
  let m;
  while ((m = ROUTE_RE.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    const routePath = m[3];
    const rest = m[4] || '';
    rows.push({
      method,
      path: routePath,
      chainNames: extractChain(rest),
      policy: null,
    });
  }
  return rows;
}

function analyzeRouteFiles({ prefix, files }) {
  const out = [];
  for (const file of files) {
    for (const row of analyzeFile(file)) {
      out.push({ ...row, path: prefix + row.path });
    }
  }
  return out;
}

// Transcribed from src/app.js:250-282 - the app.use('/api/...', ...) block.
// If a router is added to app.js, add it here. The route-policy test asserts
// that every route module required by app.js appears in this list.
const MOUNTS = [
  { prefix: '/api',                file: 'medication.js' },
  { prefix: '/api/prescription',   file: 'prescription.js' },
  { prefix: '/api/cart',           file: 'cart.js' },
  { prefix: '/api/med-checkout',   file: 'checkout.js' },
  { prefix: '/api/med-confirmation', file: 'confirmation.js' },
  { prefix: '/api/med-track',      file: 'track.js' },
  { prefix: '/api/pharmacy',       file: 'pharmacy.js' },
  { prefix: '/api/auth',           file: 'session.js' },
  { prefix: '/api/auth',           file: 'auth.js' },
  { prefix: '/api/admin',          file: 'admin.js' },
  { prefix: '/api/consent',        file: 'consent.js' },
  { prefix: '/api/refunds',        file: 'refunds.js' },
];

function analyzeAll(routesDir) {
  const out = [];
  for (const m of MOUNTS) {
    const file = require('node:path').join(routesDir, m.file);
    if (!fs.existsSync(file)) continue;
    for (const row of analyzeFile(file)) {
      out.push({ ...row, path: m.prefix + row.path });
    }
  }
  return out;
}

function toKey(row) {
  return `${row.method} ${row.path}`;
}

module.exports = { analyzeFile, analyzeRouteFiles, analyzeAll, toKey, MOUNTS };