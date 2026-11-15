// tests/route-module-load.test.js
//
// Task 6: every route file under src/routes/*.js must load in real Node.
//
// Why this exists
// ---------------
// Twice this session, a route file referenced requireCapability in a middleware
// chain but did not import it. Both times the static route-policy test passed
// (it reads source text, it does not require the module), and both times the
// failure surfaced only when the file was loaded by real Node:
//   - src/routes/auth.js  (caught by auth-error-contract.test.js)
//   - src/routes/pharmacy.js (caught by a production deploy: ReferenceError)
//
// The route-policy test and this test check orthogonal properties:
//   route-policy.test.js      -> every route is declared
//   route-module-load.test.js -> every file loads
// Both are required. Neither substitutes for the other.
//
// Design: Option C (child process per file)
// ------------------------------------------
// Requiring route files in-process would drag in ESM-only packages
// (file-type, expo-server-sdk, parse5 via isomorphic-dompurify) that Jest 29
// cannot resolve without Babel -- the same reason src/core/authz/policy-registry.js
// does static analysis instead of require. Spawning `node -e require(...)` per
// file asks the real runtime the honest question ("does this file load in the
// environment we deploy to?") without contorting Jest.
//
// Env stubs: admin.js and prescription.js require ../utils/supabaseClient at
// load time, which calls createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// at module-eval. Those vars are present on Render and absent in a bare local
// shell. Stub them in the child env so the test answers "does the module graph
// load?" rather than "is this machine configured like production?". If a route
// file has a real code-level load bug, it still throws with the stub values.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');

// Child-process env: start from the current process env so CI-injected vars
// (JWT_SECRET, DATABASE_URL, etc.) pass through, then add stubs for the two
// vars we know are required at load time and absent locally.
function childEnv() {
  return {
    ...process.env,
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://stub.example',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key',
    JWT_SECRET: process.env.JWT_SECRET || 'test-secret',
    NODE_ENV: process.env.NODE_ENV || 'test',
    // Some modules print on load; keep output off unless a test fails.
    SUPPRESS_LOAD_LOGS: '1',
  };
}

function requireOne(fileName) {
  const rel = './src/routes/' + fileName;
  return execFileSync(
    process.execPath, // current node binary
    ['-e', `require(${JSON.stringify(rel)});`],
    {
      cwd: path.join(__dirname, '..'),
      env: childEnv(),
      stdio: 'pipe',
      timeout: 15000,
    }
  );
}

describe('route modules load in real Node (Task 6 smoke gate)', () => {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();

  test('there is at least one route file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`src/routes/${file} loads without throwing`, () => {
      // execFileSync throws on non-zero exit; the catch below re-throws with
      // stderr captured so a load failure is readable in the Jest report.
      try {
        requireOne(file);
      } catch (err) {
        const stderr = err && err.stderr ? String(err.stderr) : '(no stderr)';
        const stdout = err && err.stdout ? String(err.stdout) : '(no stdout)';
        throw new Error(
          `src/routes/${file} failed to load.\n` +
            `--- stderr ---\n${stderr}\n` +
            `--- stdout (tail) ---\n${stdout.slice(-1000)}\n`
        );
      }
    });
  }
});
