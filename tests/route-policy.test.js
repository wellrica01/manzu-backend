// tests/route-policy.test.js
// Doc 1 S4.2: every route has a declared policy.
//
// Approach: static analysis of src/routes/*.js. The routers cannot be
// `require`d under Jest 29 because their handlers pull in ESM-only packages
// (file-type, expo-server-sdk, parse5 via isomorphic-dompurify) that Jest's
// resolver cannot load without Babel. policy-registry.analyzeAll() parses
// route declarations from source text and returns { method, path, chainNames,
// policy }. The chainNames list lets us see which middleware is on each
// route; `policy` is null until routes are decorated with requireCapability
// or publicRoute (FND-04e+).
//
// Grandfather snapshot: tests/route-policies.grandfathered.json
// Contains every route with no policy tag today (159 entries after FND-04d).
// The snapshot shrinks as Docs 2/3/4 decorate routes; when it is empty, the
// Phase 1 exit criterion for this test is met.
//
// Audit findings surfaced by this test (P0 for Doc 2/3/4, not fixed here):
//   1. GET  /api/prescription/prescriptions/:id/validity
//   2. DELETE /api/prescription/remove/:id/medications
//   3. DELETE /api/prescription/remove/:id/medications/:prescriptionMedicationId
//   4. POST /api/pharmacy/profile/logo
//   5. POST /api/admin/medications
//   6. PATCH /api/admin/medications/:id
//   7. DELETE /api/admin/medications/:id
//   8. POST /api/admin/reconciliation/trigger
//   9. GET /api/admin/reconciliation/:id
//  10. GET /api/admin/reconciliation
// Each of these currently has NO auth middleware in its chain. Some are
// plausibly public (guest flows); the pharmacy and admin ones are not.
// See PR description for the classification.

const fs = require('node:fs');
const path = require('node:path');
const { analyzeAll, toKey, MOUNTS } = require('../src/core/authz/policy-registry');

const SNAPSHOT = path.join(__dirname, 'route-policies.grandfathered.json');

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT)) return [];
  return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
}

function snapshotOf(walked) {
  return walked.filter((r) => !r.policy).map(toKey).sort();
}

describe('route policy coverage (Doc 1 S4.2)', () => {
  let walked;
  let snapshot;

  beforeAll(() => {
    process.env.SEC_ENFORCE = process.env.SEC_ENFORCE || 'off';
    walked = analyzeAll(path.join(__dirname, '..', 'src', 'routes'));
    snapshot = readSnapshot();
  });

  it('the analyzer found routes', () => {
    expect(Array.isArray(walked)).toBe(true);
    expect(walked.length).toBeGreaterThan(100);
  });

  it('no new route is missing a policy', () => {
    const inSnapshot = new Set(snapshot);
    const offenders = snapshotOf(walked).filter((k) => !inSnapshot.has(k));
    if (offenders.length > 0) {
      throw new Error(
        `New route(s) with no declared policy:\n  ${offenders.join('\n  ')}\n\n` +
        'Declare a policy with requireCapability(...) or publicRoute(reason).\n' +
        'If this route belongs to a later Doc, add it to ' +
        'tests/route-policies.grandfathered.json and note the doc in the PR.'
      );
    }
    expect(offenders).toEqual([]);
  });

  it('no grandfathered route has since gained a policy', () => {
    const byKey = new Map(walked.map((r) => [toKey(r), r]));
    const decorated = snapshot.filter((k) => byKey.has(k) && byKey.get(k).policy);
    if (decorated.length > 0) {
      throw new Error(
        `Route(s) now have a policy but are still in the snapshot:\n  ${decorated.join('\n  ')}\n\n` +
        'Remove them from tests/route-policies.grandfathered.json in this PR.'
      );
    }
    expect(decorated).toEqual([]);
  });

  it('no grandfathered route has been deleted', () => {
    const byKey = new Set(walked.map(toKey));
    const stale = snapshot.filter((k) => !byKey.has(k));
    if (stale.length > 0) {
      throw new Error(
        `Route(s) in the snapshot no longer exist:\n  ${stale.join('\n  ')}\n\n` +
        'Remove them from tests/route-policies.grandfathered.json in this PR.'
      );
    }
    expect(stale).toEqual([]);
  });

  it('every route module required by src/app.js is covered by MOUNTS', () => {
    // If someone adds a router to app.js but forgets to add it to
    // policy-registry.MOUNTS, this test catches it, so the walker stays in
    // sync with the app's mounted routes.
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
    const requiredRouteNames = new Set();
    const re = /require\(['"]\.\/routes\/([a-z-]+)['"]\)/g;
    let m;
    while ((m = re.exec(appSource)) !== null) requiredRouteNames.add(m[1]);
    const mountedNames = new Set(MOUNTS.map((mount) => mount.file.replace(/\.js$/, '')));
    const missing = [...requiredRouteNames].filter((name) => !mountedNames.has(name));
    if (missing.length > 0) {
      throw new Error(
        `src/app.js requires router(s) not covered by policy-registry.MOUNTS:\n  ` +
        missing.join('\n  ') +
        '\n\nAdd them to MOUNTS in src/core/authz/policy-registry.js.'
      );
    }
    expect(missing).toEqual([]);
  });
});