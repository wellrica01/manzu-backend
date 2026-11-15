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
//
// Policy derivation (P-02 / FND-04e):
//   - If the chain contains a call to requireCapability(...), the route has a
//     capability policy:  policy = { type: 'capability', capability?, tier?, rate? }.
//     The decorator's own returned middleware carries
//     { type, capability, tier, rate, resource }; we reconstruct the parts we
//     can read from the source text (a simple quoted string first argument),
//     and mark unknown fields null. The CI test only requires policy != null
//     for the route to count as declared.
//   - If the chain contains a call to publicRoute(...), the route has a public
//     policy:  policy = { type: 'public', reason? }.
//   - If the chain contains ONLY requireStepUp(...), the route is still treated
//     as undeclared for the route-policy test. require-stepup.js's own header
//     says so: step-up alone does not satisfy "has requireCapability or
//     publicRoute"; the route stays in the grandfathered snapshot until a
//     capability is added.
//   - Anything else stays policy: null.
//
// Regex chosen for the actual codebase style - every route is declared as
// a single call to router.<verb>('<path>' with the middleware chain
// following, and a handler at the end.

const fs = require('node:fs');

const ROUTE_RE = /router\.(get|post|put|patch|delete|all)\s*\(\s*(['"])([^'"]+)\2([\s\S]*?)(?=router\.(?:get|post|put|patch|delete|all)\s*\(|^\}\s*|(?![\s\S]))/gm;

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

// Pull the first string-literal argument of a named call from the chain source.
// Returns the string, or undefined if the argument is not a simple quoted
// literal (the analyzer is deliberately conservative: expression arguments
// leave the field undefined rather than guessed).
function firstStringArg(rest, fnName) {
  const re = new RegExp('\\b' + fnName + '\\s*\\(\\s*([\'"])([^\'"]+)\\1');
  const m = re.exec(rest);
  return m ? m[2] : undefined;
}

// Derive the policy tag from a route's chain. See file header for the rules.
function derivePolicy(chainNames, rest) {
  const hasCapability = chainNames.includes('requireCapability');
  const hasPublic = chainNames.includes('publicRoute');
  // requireStepUp alone does not satisfy the route-policy test's predicate;
  // see require-stepup.js header. Only requireCapability/publicRoute count.
  if (!hasCapability && !hasPublic) return null;

  if (hasPublic) {
    return {
      type: 'public',
      reason: firstStringArg(rest, 'publicRoute') || null,
    };
  }

  // hasCapability. We cannot reliably parse the options object from source
  // text, so tier and rate are best-effort: if the source contains them as
  // simple string-literal arguments we copy them; otherwise null. The route
  // is declared either way; richer fields are enforced once P-01 decorates
  // the routes and the shape can be tested directly.
  return {
    type: 'capability',
    capability: firstStringArg(rest, 'requireCapability') || null,
    tier: firstStringArg(rest, 'tier') || null,
    rate: firstStringArg(rest, 'rate') || null,
  };
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
    const chainNames = extractChain(rest);
    rows.push({
      method,
      path: routePath,
      chainNames,
      policy: derivePolicy(chainNames, rest),
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
