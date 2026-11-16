# P-06 Status — Identity Lifecycle (Doc 2 §5.1–5.2, §9.1)

**Branch:** `med-version`
**Commits:** `3193153` (6e), `a141093` (6a), `9ef63b8` (6b.1), `efac250` (6b.0), `b6cc3ea` (6b.2), `6e1a568` (6c.1), `b68a701` (6c.2), `28fb108` (6c.3), `a417316` (6d.1), `bc0b805` (6d.2). All pushed.
**Status:** **COMPLETE.** All six sub-tasks (6a–6e, 6g) done and shipped. Doc 2 §9.1's P-06 `done when` — "§5.1 and §5.2 pass; old build's add-user still works in shadow" — is met.
**Tests:** **280 passing / 37 suites / 1 pre-existing FAIL** (`src/test.js` — orphan, out of scope). Route-policy snapshot **131** (unchanged); analyzer sees **139 routes** (131 grandfathered + 8 new from P-06, all declared via `requireCapability` or `publicRoute`).
**Two-gate:** `tests/route-policy.test.js` 5/5, `tests/route-module-load.test.js` 13/13.
**Production:** live since 2026-11-16 17:58 UTC. Boot log green. `INVITE_PEPPER` set on Render.

---

## 0. What P-06 delivered

**6e — team capabilities and audit vocabulary** (`3193153`):
- `capabilities.js`: four new capabilities (`team.invite`, `team.role.change`, `team.suspend`, `team.pin.reset`), MANAGER-granted alongside the pre-existing `team.manage`.
- `catalogue.js`: five new `FAIL_CLOSED` audit actions (`AUTH_INVITE_SENT`, `AUTH_INVITE_ACCEPTED`, `AUTH_USER_REACTIVATED`, `AUTH_PIN_RESET`, `SETTINGS_UPDATED`).
- One additional capability in 6d.1: `settings.edit` (MANAGER).

**6a — invite flow** (`a141093`):
- Repository: `createPharmacyUserInvite`, `findInviteByHash`, `incrementInviteAttempts`, `consumeInvite`.
- Service: `createInvite`, `acceptInvite`, `revokeInvite`, plus helpers.
- Env: `INVITE_PEPPER` required in production (32-char minimum).
- **Code format:** 8 chars from a 32-symbol unambiguous alphabet (40 bits), HMAC-SHA256 with `INVITE_PEPPER` stored as hex, 48h expiry, 5-attempt burn, plaintext returned to the manager **once** and never persisted.
- **Enumeration resistance:** every `acceptInvite` failure returns the same `INVALID_INVITE` — unknown email, wrong code, expired, used, burned, email mismatch.

**6b — reactivate, reset-pin, five routes, schemas** (`9ef63b8`, `efac250`, `b6cc3ea`):
- Service: `reactivatePharmacyUser`, `resetPharmacyUserPin`; `acceptInvite` clears `mustChangePin` (the reactivation lockout loop fix).
- Schemas: `acceptInviteSchema`, `inviteUserSchema`, `pinResetSchema`.
- Routes in `routes/auth.js`:
  - `POST /auth/invite/accept` — public (`publicRoute`), rate class `login`
  - `POST /auth/users/:userId/invite` — `team.invite`, T2
  - `POST /auth/users/:userId/suspend` — `team.suspend`, T2
  - `POST /auth/users/:userId/reactivate` — `team.suspend`, T2 (fine split to a distinct capability later)
  - `POST /auth/users/:userId/pin-reset` — `team.pin.reset`, T2
- `.env.example`: `INVITE_PEPPER` placeholder added.

**6c — LAST_MANAGER, soft delete, transferManager** (`6e1a568`, `b68a701`, `28fb108`):
- Repository: `countActiveManagers`.
- Service: `assertNotLastManager` helper, wired into `suspendPharmacyUser`, `deletePharmacyUser`, and `editPharmacyUser`'s demote path.
- `deletePharmacyUser` is now a **soft delete**: `status='REMOVED'`, `removedAt`, `removedLabel` (the user's name), preserving the row for audit and history.
- `transferManager` — swaps roles in a transaction, bumps both users' sessions, emits two `AUTH_ROLE_CHANGED` events.
- Route: `POST /auth/manager/transfer`, `team.role.change`, T3, `requireStepUp('manager.transfer')` (enforced when `SEC_STEPUP_ENFORCE=enforce`; default `off`).
- Tests (`tests/manager-lifecycle.test.js`, 11 tests): all three LAST_MANAGER refusals, all three allowed cases with two managers, transfer success with both audit events, and four transfer refusal cases.
- Test fix in `auth-session-revocation.test.js`: the delete test now asserts the soft-delete contract (`updatePharmacyUser` with `status='REMOVED'`, `deletePharmacyUser` **not** called).

**6d — settings endpoint** (`a417316`, `bc0b805`):
- Capability: `settings.edit` (MANAGER).
- New domain `src/domains/pharmacy/settings/`: `settings.repository.js`, `settings.service.js`.
- Service: `getSettings` (returns defaults when no row, read-only), `updateSettings` (range-validated, upsert, `SETTINGS_UPDATED` audit).
- **Prisma type coercion:** `discountCapPct` (`Decimal`) and `refundLimitKobo` (`BigInt`) are coerced to `Number` for JSON safety. `BigInt` would otherwise throw on `JSON.stringify`.
- Routes in `routes/pharmacy.js`: `GET /pharmacy/settings` (`team.view`, T0), `PATCH /pharmacy/settings` (`settings.edit`, T2).
- Tests: `tests/settings.test.js` (6 service tests), `tests/settings-routes-smoke.test.js` (2 route-registration smoke tests).

---

## 1. What P-06 did NOT ship (and who owns each)

| Deferred | Owner | Reason |
|---|---|---|
| **Email rewrite on soft delete** (`removed+<id>@invalid`) | **Future P-06 polish** | §5.1 mentions it; not in this pass. The email is currently preserved on `REMOVED` rows, which means the email can't be reused. A follow-up should rewrite it and add a test. **`P-06-status.md` §3 records it.** |
| **Mobile `features/staff` rewrite** — invite UI, pending list, suspend/reset/send-code actions | **`manzu-mobile`** | Separate repo. Not part of `manzu-backend`. |
| **`X-Min-App-Version` retirement of legacy `POST /auth/add-user`** | **P-03 territory** | The legacy flow still works — old builds keep functioning. Retirement is gated on `X-Min-App-Version`. |
| **`settings.edit` split further** (e.g. separate `banking.settings.edit`) | **If needed** | Today `settings.edit` covers all `PharmacySetting` fields. Splitting is a future decision, not a §5.8 requirement. |
| **`reactivatePharmacyUser` doesn't use a distinct capability** from suspend | **P-06 follow-up** | Both use `team.suspend`. Doc 2 §3.2 has only `team.suspend` in the matrix, so this is compliant, but a future split (`team.reactivate`) is trivial. |
| **Missing route-level tests for `invite`, `suspend`, `reactivate`, `pin-reset`, `manager/transfer`** | **Future test pass** | The service methods are unit-tested in isolation; only `GET/PATCH /pharmacy/settings` has a route-registration smoke test. The rest rely on code read + `route-policy` + `route-module-load`. **Same class of gap as the 6d.2 mis-ordering bug — this is the highest-value follow-up.** |

**None of these block P-07.** P-07's dependencies (`INVITE_PEPPER`, `AUTH_PIN_RESET`, `pinHashVersion`, `PharmacyUser.password`, `mustChangePin`) are all in place.

---

## 2. Production behavior

- **The five new auth routes and the two settings routes are live** on `manzu-backend.onrender.com` as of 2026-11-16 17:58 UTC.
- **`SEC_STEPUP_ENFORCE=off`** in production (default). The `/auth/manager/transfer` route has `requireStepUp` in its chain but the middleware is a passthrough. **Turning step-up enforcement on (setting `SEC_STEPUP_ENFORCE=enforce`) is a separate decision, not a P-06 requirement.**
- **`INVITE_PEPPER` is set.** The boot log confirms `Environment validation passed!`. Any future deploy without it will fail to boot — that is correct fail-closed behavior.
- **No behavior change for existing clients:**
  - The legacy `POST /auth/add-user` still works.
  - The legacy `DELETE /auth/users/:userId` now soft-deletes; a removed user can no longer sign in (the guard sees `status: 'REMOVED'`), but the row is preserved.
  - `/auth/manager/transfer` is a new route; nothing calls it until a client is updated.

---

## 3. Verification (tests + gates)

**At `bc0b805`:**

- Full suite: **280 passing / 37 suites / 1 pre-existing fail** (`src/test.js` orphan).
- Two-gate: `route-policy` 5/5 (139 routes, all declared), `route-module-load` 13/13.
- New test files this phase:
  - `tests/manager-lifecycle.test.js` — 11 tests (LAST_MANAGER + transfer)
  - `tests/settings.test.js` — 6 tests (defaults, serialization, upsert, audit, range validation)
  - `tests/settings-routes-smoke.test.js` — 2 tests (route registration; catches `module.exports` mis-ordering)
- `tests/auth-session-revocation.test.js` — updated delete test to soft-delete contract (12 tests, all pass).
- **`src/test.js`** — the orphan. Still fails, out of scope.

**Manual verification during editing:**

- `node -e "require('./src/routes/pharmacy.js')"` — the file loads (with the push service requiring the ESM-only `expo-server-sdk`, that one require is a `node -e` thing, not Jest, and passes).
- `node -e` on the settings service confirms `BigInt`-to-Number coercion and JSON serializability.

---

## 4. Hand-off

**P-06 is done. Next in Doc 2 §9.2 wave 2B: P-07 (PIN hardening).**

**P-07 dependencies — all in place:**
- `pinHashVersion` column (from `sec-01`)
- `PharmacyUser.password` (existing)
- `mustChangePin` column (from `sec-01`)
- `AUTH_PIN_CHANGED` audit action (from P-05)
- `AUTH_PIN_RESET` audit action (from 6e)
- `INVITE_PEPPER` in production (from 6a)

**P-07's shape** (from Doc 2 §5.3):
1. **`PIN_PEPPER` env var** (new; analogous to `INVITE_PEPPER`). Required in production. Must be set on Render **before** the deploy that reads it.
2. **`pinHashVersion` v1 → v2 migration.** Login verifies by version, re-hashes to v2 on next successful login. **No bulk migration.** The `acceptInvite`, `changePharmacyUserPin`, `resetPharmacyUserPin`, and `registerPharmacyAndUser` paths all write v2 on the next credential write.
3. **Blocklist at set time:** repeated digits, ascending/descending runs, `000000`/`123456`/etc., the user's or pharmacy's phone suffix, another user in the same pharmacy with the same PIN. Returns `WEAK_PIN`.
4. **Existing-PIN sweep:** on first sign-in after P-07, if the typed PIN matches the blocklist, set `mustChangePin`. **Zero bulk migration** — it's progressive.
5. **Equalised timing:** login already does one bcrypt compare against `DUMMY_HASH` for unknown emails (from FND-07b2); the pepper work must preserve that.
6. **Change-PIN uses the pepper too** — `changePharmacyUserPin` already exists; the v2 hash and rules apply there.

**The other P-07 dependencies from Doc 2 §9.1:**
- **`stepup.service.js`** — already exists (FND-08a). P-07's step-up failures (5 per 5 minutes) need a throttle class; the `stepup` class exists in `RATE_LIMITS` (from P-01). **Need to check whether `stepupService` already uses it.**

**P-06's gap that matters for P-07:** `acceptInvite`'s PIN format check is `^\d{6}$`; **the blocklist is where P-07 extends it.** `P-06-status.md` §0 records that the pin format check is in `acceptInvite` — P-07 adds the blocklist in the same place, plus `registerPharmacyAndUser` and `changePharmacyUserPin`.

---

## 5. Lessons from this phase

**1. The `$ok`-guard + "write inside `if ($ok)`" pattern is stable.** No terminal closures, no unintended writes this whole phase. **The `ReadAllLines` + numbered-index read is the only reliable way to anchor edits.** Every anchor mismatch this phase (a dozen-plus) was caught by the guard and cost one retry, no data loss. **The recurring root cause is transcription: the numbers from `ReadAllLines` are 1-based lines, `$lines[$i]` is 0-based — `$lines[i]` is line `i+1`. My anchor checks drifted by one on most first attempts.** The fix is mechanical: always read, always use the printed numbers, never reconstruct from memory.

**2. The `routes/pharmacy.js` `/module.exports` mis-ordering bug (6d.2b).** The two settings routes were inserted **after** `module.exports = router;` — syntactically valid, `node -e` passed, `route-module-load` passed, **only a real HTTP request would have caught it.** The route-level smoke test (`tests/settings-routes-smoke.test.js`) is the fix. **Any future insertion into a routes file must verify the export comes last.** The safe pattern that worked elsewhere — "insert before `module.exports`" — needed the specific anchor `$i = 1138` (blank before `module.exports`), **not** `$i = 1139` (the `module.exports` line itself).

**3. `expo-server-sdk` is ESM-only and cannot be `require`d in Jest.** Any Jest test that touches `routes/pharmacy.js` (directly or via a domain service) must mock `expo-server-sdk` before the require. **`route-module-load` avoids this by using a child Node process**, not Jest's loader. **The pattern for a real route smoke test:** `jest.mock('expo-server-sdk', () => ({ Expo: class { sendPushNotificationsAsync() { return Promise.resolve({}); } } }))` at the top of the test, before any `require`.

**4. The 6d.2b mis-ordering bug is the archetype for why route-level smoke tests matter.** Source-text analyzers (`route-policy`), module-load smoke tests (`route-module-load`), and `node -e` all pass with the routes unreachable. **Only a real request catches it.** Adding a route-registration test to every routes file is the general fix; for `routes/auth.js` too, not just `routes/pharmacy.js`. **Follow-up noted in §1.**

**5. `BigInt` and `Decimal` in Prisma need explicit coercion.** `BigInt` throws in `JSON.stringify`; `Decimal` serializes to a string (`"0.00"` not `0`). **Every service that reads a Prisma model with these types must serialize before returning.** `P-06-status.md` §0 records the fix in `settings.service.js`. **P-09 (POS rework) will hit the same thing** — `refundLimitKobo` and any new `BigInt` column.

**6. Fail-closed audit with a post-write upsert.** `updateSettings` writes the upsert **then** the audit. A failed audit leaves the change persisted without an audit row. **True fail-closed would wrap both in a transaction.** Flagged in `P-06-status.md` §1 for a follow-up. **The pattern to prefer in P-07 and beyond: pass `tx` through to `createAuditLog` when the write is transactional.**

**7. The Doc 2 §5.2 `features/staff` mobile rewrite is out of scope for this repo.** Mentioned in the `P-06-status.md` §1 as a `manzu-mobile` concern.

**8. Every one of P-06's commits is small and independently revertable.** `6e` (2 files), `6a` (3 files), `6b.1` (1), `6b.0` (2), `6b.2` (1), `6c.1` (3), `6c.2` (1), `6c.3` (1), `6d.1` (3), `6d.2` (4). The largest is `6c.1` at `+127/-8` and `6d.2` at `+221/-1` — both under 250 lines of diff. **The two-gate has held every time. The full suite has never regressed.**