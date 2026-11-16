# P-04 Status — Auth Lifecycle (Doc 2 §5.1–5.4, §9.1)

**Branch:** `med-version`
**Commits:** `1645098` (P-04/a), `a7576d1` (P-04/c) — both pushed to `origin/med-version`.
**Deploy:** live as of 2026-11-16 14:58 UTC. Boot log green: env valid, DB connected, all routes load, all crons started, no `ReferenceError`.
**Tests:** 240 passing / 32 suites / 1 pre-existing FAIL (`src/test.js` — orphan, out of scope). Route-policy snapshot: **131** (unchanged — P-04 touched no route file).
**Two-gate:** `tests/route-policy.test.js` 5/5, `tests/route-module-load.test.js` 13/13.
**Owner action (open):** run `prisma/sql/sec-04-pharmacy-team.sql` on Supabase before P-06 ships. See §5.

**Purpose of this document:** record what P-04 shipped, what it deferred, which package owns each deferred piece, and the deploy-safety window that allowed P-04 to ship before `sec-04` runs.

---

## 0. What P-04 delivered

The exit-test is met with margin: **a token minted before a role change, a PIN set, an email change, a delete, or a suspend is refused with `SESSION_REVOKED 401` on its next request** — one request, not 60 seconds.

Delivered:

1. **The primitive** — `bumpTokenVersionAndRevoke(userId)` in `pharmacy-session.repository.js`: one `$transaction` that increments `PharmacyUser.tokenVersion` and revokes every live `PharmacyRefreshToken` family for the user. Exposed through `pharmacy-session.service.js` for call sites that should not touch the repository.
2. **The call sites** in `pharmacy-auth.service.js`:
   - `editPharmacyUser` now bumps+revokes on **role change, PIN set, or email change**. Before: only when `pin` was set — a pure demotion left the refresh family alive, so the demoted user could refresh into a new lease for 30 days. **This was the actual P-04 gap** (Doc 2 §2.2 "Demoted user keeps access up to 1 day" understates it: the *authorization* view was already fresh via FND-05b3's DB read, but the *session chain* never ended).
   - `deletePharmacyUser` now bumps+revokes **before** the delete. Before: no revocation at all; the access token stayed valid for its TTL.
   - New `suspendPharmacyUser(userId, managerId, pharmacyId)` — sets `status='SUSPENDED'`, `suspendedAt`, `suspendedById`, then bumps+revokes. **Not routed.** P-06's `POST /auth/users/:userId/suspend` is the caller.
3. **The schema and SQL for the team lifecycle** — `1645098`:
   - `prisma/schema.prisma`: `PharmacyUser` gains `lastActiveAt`, `invitedById`, `suspendedAt`, `suspendedById`, `removedAt`, `removedLabel`, `licenceNumber`, `licenceVerifiedAt`; `UserDevice` gains `platform`, `approvedById`, `approvedAt`; new `PharmacyUserInvite` and `PharmacySetting` models; `PharmacySetting?` back-relation on `Pharmacy`; `@@index([pharmacyId, status])`.
   - `prisma/sql/sec-04-pharmacy-team.sql`: idempotent, `BEGIN…COMMIT`, widens the status CHECK to add `REMOVED`, creates the two tables and the index. **Owner-run, not `prisma migrate`.**
4. **Three complementary tests** — they prove different layers and do not substitute for each other:
   - `tests/session-revocation.test.js` (existing, 13 tests): the **guard** refuses on `tokenVersion` mismatch, dead refresh family, non-ACTIVE status, `isActive=false`, missing row, `mustChangePin`, `lockedUntil`.
   - `tests/token-version-bump.test.js` (new, 4 tests): the **primitive** increments once, revokes only live families, does both writes inside one `$transaction`, and a token minted at `tv:0` is refused after the bump.
   - `tests/auth-session-revocation.test.js` (new, 10 tests): the **call sites** invoke the primitive for role/PIN/email change, delete, suspend, **and do not** invoke it for name-only changes, same-role updates, self-target, or unknown-user.

---

## 1. What P-04 did NOT ship (and who owns each)

Doc 2 §9.1's P-04 row is deliberately narrower than §5.1–5.4. Each deferred piece below belongs to a later package and is a named dependency, not P-04 debt.

| Deferred | Owner | Reason |
|---|---|---|
| Invite flow (`POST /auth/invite/accept`, one-time codes, `PharmacyUserInvite` CRUD) | **P-06** | §5.2. The `PharmacyUserInvite` table exists; the flow does not. Legacy `add-user` keeps working in shadow until `X-Min-App-Version`. |
| `LAST_MANAGER` guard, `POST /auth/manager/transfer` | **P-06** | §5.1. Needs `suspendPharmacyUser` + a route + a count check; the service method ships now so P-06 has a target. |
| `REMOVED` soft-delete behaviour (email rewrite, `removedLabel`, keeping the row for history) | **P-06** | §5.1. The status value and columns exist; `deletePharmacyUser` is still a hard delete. P-06 replaces it with the soft delete and calls `bumpTokenVersionAndRevoke` (already in place). |
| `GET/PATCH /pharmacy/settings` (`PharmacySetting` CRUD) | **P-06** | §3.4/§5.8. Table ships now; routes P-06. |
| PIN pepper (`PIN_PEPPER`), `pinHashVersion` v2, blocklist, equalised timing on change-PIN | **P-07** | §5.3. `pinHashVersion` column exists from `sec-01`. |
| Per-account lockout at the per-IP / unknown-email bucket granularity of §5.4 | **P-04.2b — done** (`d72080f`, `f161359`, `b0bdb08`) | Resolved: IP bucket is now class `auth_ip` at 30/15min with no reset on success; the per-account ladder (5/8/12) is authoritative via `failedAttempts`/`lockedUntil` with `security.record` (warning) at 8 and `security.notify` (critical) at 12. The throttle no longer overlaps the account counter. Unknown-email shares the hashed-email bucket. |
| Pharmacy status transitions (`PENDING`/`VERIFIED`/`SUSPENDED`/`CLOSED`) driving writes | **Doc 3** | §5.7. P-04 already enforces `isActive=false` → `PHARMACY_SUSPENDED` via FND-05b3; the workflow state itself is Doc 3's. |
| Device registry usage, new-device approval | **P-13** | §5.5. `UserDevice` columns added in `1645098`; behaviour is P-13. |
| Admin-assisted manager recovery / unlock | **Doc 3 A-11** | §5.7. |

**None of these block the P-04 exit test.** They block P-06, P-07, and Doc 3 — each of which runs after P-04 per Doc 2 §9.2.

---

## 2. Deploy-safety window — why P-04 shipped before `sec-04` runs

The C2.1 and C2.2 call sites (`editPharmacyUser` role/PIN/email change, `deletePharmacyUser`) write only to columns that exist from `sec-01`: `tokenVersion`, `status`, `password`, `role`, `email`. Those paths **work against the current Supabase DB before `sec-04` runs.**

Only `suspendPharmacyUser` writes `suspendedAt` and `suspendedById`, which `sec-04` adds. **It has no route**, so no traffic can reach it. It will be reachable the moment P-06 adds `POST /auth/users/:userId/suspend` — which is why the owner must run `sec-04` **before P-06 ships**, not before P-04.

This is recorded because the PR title reads "P-04" but the SQL file is a P-06 prerequisite in practice. Whoever picks up P-06 reads this file first.

---

## 3. What did not change

- **No route files touched.** `route-policy` snapshot stays at **131**; `route-module-load` stays at 13 files. P-04 added no routes and deleted none.
- **`authenticate()` untouched.** FND-05b3 already does DB-validating auth: reads `status`, `tokenVersion`, `mustChangePin`, `lockedUntil`, pharmacy `isActive`, refresh family, and compares `decoded.tv` to the DB value. P-04 hooks into that comparison; it does not reimplement it.
- **`SEC_ENFORCE` untouched.** Already `enforce` (P-01 §5 step 5).
- **`prisma/migrations/` untouched.** Only `prisma/sql/sec-04-pharmacy-team.sql` (hand-written, owner-run). `prisma generate` run locally; nothing migration-related.
- **Existing tests unchanged in behaviour.** `equal-time-login.test.js` got a one-line mock addition (`bumpTokenVersionAndRevoke: jest.fn()`) so future tests against `editPharmacyUser` don't hit `undefined is not a function`. The tests themselves pass unchanged.


---

## 4. Verified on production

Boot log 2026-11-16 14:58 UTC (`manzu-backend.onrender.com`):

~~~
Environment validation passed!
.env is properly ignored by git
Sentry initialized: { environment: 'production', dsn: 'Configured' }
Rate limiting configured (4 classes)
Loaded medication.js / prescription.js / checkout.js / confirmation.js / track / pharmacy.js / auth / admin / consent / refunds
Payment reconciliation job initialized
Refund processing cron jobs initialized
Payout cron jobs initialized
Database backup jobs initialized
Error handlers initialized
Server running on port 10000
Database connected successfully
==> Your service is live
~~~

No `ReferenceError`, no `requireCapability is not defined`, no `PrismaClientInitializationError`. Same checklist as P-01-status section 7. The mojibake on the "Error handlers initialized" line in the raw Render log is a PowerShell codepage rendering of the checkmark emoji in the log tail - cosmetic, not a code issue.

Pre-existing behaviour observed, not from P-04: `Request with no origin in production` (CORS, pre-P-04); rate-limit class `Authentication: 5 attempts / 15 min` (pre-P-04, from authLimiter).

---

## 5. Owner action - required before P-06, recommended now

~~~
Run on Supabase (eu-central-2), in the SQL editor or psql:

  prisma/sql/sec-04-pharmacy-team.sql

Order: after sec-01-identity-session.sql. Idempotent (BEGIN...COMMIT;
ADD COLUMN IF NOT EXISTS; DO-block for the CHECK constraint). Safe to re-run.

Do NOT run prisma migrate / prisma db push / prisma migrate reset against Supabase -
no _prisma_migrations table exists, and the command would try to reconcile
against nothing.

Prisma side: schema.prisma already updated (1645098); prisma generate already run.
~~~

After sec-04 runs and the owner confirms, update this file with the timestamp and who ran it.

**Status: RUN** — 2026-11-16 on Supabase (eu-central-2). Verified: 8 `PharmacyUser` columns, `REMOVED` in the status CHECK, 3 `UserDevice` columns, `PharmacyUserInvite` (3 indexes), `PharmacySetting` (14 columns), composite index. Matches local `my_manzu_db`. P-06 is unblocked.

---

## 6. Lessons from this phase

1. throw in the edit script template did not stop execution. In one PowerShell edit block, the anchor check failed and throw was called - but subsequent statements still ran (PowerShell only terminates the current pipeline/statement, not the script in a -Command session). The write happened anyway, producing a syntactically-valid-but-wrong file (a bumpTokenVersionAndRevoke label outside the object literal). Tests passed because no test exercised the changed path - a false green.

Fix for the template: every edit block now uses an $ok flag, break on mismatch, $ok = $false, and if (-not $ok) { Write-Host "ABORT: no file change."; return } before the write. return at script scope stops execution; throw alone does not.

2. Get-Content in PowerShell 5.1 decodes as the system codepage, not UTF-8. When a file contains non-ASCII characters, Get-Content renders mojibake and any round-trip through Get-Content to Set-Content/WriteAllText corrupts the bytes. Always use [System.IO.File]::ReadAllText(path, UTF8) and WriteAllText(..., New-Object System.Text.UTF8Encoding($false)) for files with non-ASCII. In this phase the section-sign mojibake scare was a read-side artifact - the file was correct on disk - but the rule stands: for any non-ASCII, verify with a UTF-8 read before assuming corruption.

3. Resolve-Path -LiteralPath (Split-Path -Parent bare filename) returns an empty path and throws; a failed assignment leaves the variable at its previous value. This is how the P-04-status markdown overwrote tests/auth-session-revocation.test.js - a stale $fullPath from an earlier block was used by WriteAllText after the new assignment failed. Fix: always compute $fullPath = Join-Path (Get-Location).Path $fileName, Test-Path the parent directory, and Test-Path the target after the write, aborting on any failure. The $ok-guard pattern for anchors does not cover variable-resolution failures - the path itself must be verified. The file was restored from git (git checkout -- tests/auth-session-revocation.test.js) and the 10 tests re-run green.

4. Trailing-newline convention is inverted from what was assumed. The repo's dominant convention is no trailing LF on .js files (140+ files end with 0x3B). The three files touched in a7576d1 already match this. The "No newline at end of file" markers in the staged diff are cosmetic, not defects. Do not fix them.

5. prisma validate rejects a BOM. Windows PowerShell 5.1 Set-Content -Encoding UTF8 prepends EF BB BF. prisma validate treats a BOM-prefixed schema.prisma as invalid at line 1. Use [System.IO.File]::WriteAllText with UTF8Encoding($false) for schema.prisma (and anything Prisma reads).

6. .gitattributes absent, core.autocrlf=true, and that is fine. sec-01, sec-02, and sec-04 are all stored i/lf in the index; the working tree gets CRLF via autocrlf. No per-file override is needed. Do not add .gitattributes.

7. Session-state hygiene. Two of the failures above were caused by reusing $path / $fullPath across blocks without re-initialising them in the block that used them. Every PowerShell block in this project that reads or writes a specific file must re-set $fileName, $fullPath, and (where applicable) $parentDir in that same block, and Test-Path the parent before the write. This is now the rule.

---

## 7. Hand-off

- P-05 (actor on every pharmacy audit event) is the natural next task - it uses the same sessionService pattern, and suspendPharmacyUser should write auth.user.suspended once P-05's shim exists. P-05 is unblocked.
- P-06 (invite flow, soft delete, suspend route) is the next dependency on sec-04. Run sec-04 before P-06 starts. suspendPharmacyUser is the primitive to wire.
- P-07 (PIN hardening) is independent of P-04 and can start any time after P-05.
- P-08 (bank protections) depends on P-07's step-up; unaffected by P-04.

The two-gate rule from P-01 section 7 still holds: any commit touching a route file must have tests/route-policy.test.js and tests/route-module-load.test.js green before push. P-04 touched no route file, so the snapshot stayed at 131 and the rule was not exercised - but it remains in force.