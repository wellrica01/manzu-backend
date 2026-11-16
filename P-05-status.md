# P-05 Status — Actor on Every Pharmacy Audit Event (Doc 2 §5.2, §9.1)

**Branch:** `med-version`
**Commits:** `f1c190a` (5a catalogue), `2eb22c3` (5b.1 shim before), `c81ff5f` (5b.2 order progress), `b474340` (5c auth events), `6d31472` (5d.1 test). All pushed.
**Deploy:** Render will auto-deploy on push; the change is internal (audit writes), no external behavior change except the four auth paths now fail if their audit write fails.
**Tests:** 260 passing / 34 suites / 1 pre-existing FAIL (`src/test.js` — orphan, out of scope). Route-policy snapshot **131** (unchanged — P-05 touched no route file).
**Two-gate:** `tests/route-policy.test.js` 5/5, `tests/route-module-load.test.js` 13/13.

**Purpose of this document:** record what P-05 shipped, what remains for P-06/Doc 3, the fail-closed correction made in 5c, and the PowerShell edit-pattern change adopted mid-phase.

---

## 0. What P-05 delivered

Doc 2 §9.1's "done when": **every state-changing pharmacy route writes one actor-attributed event; no event contains a PIN, token or full account number.**

Delivered:

1. **Catalogue vocabulary** (`f1c190a`) — three new actions, all `FAIL_CLOSED`:
   - `AUTH_ROLE_CHANGED: 'auth.role.changed'`, `before: ['role']`, `after: ['role', 'changedById']`
   - `AUTH_USER_SUSPENDED: 'auth.user.suspended'`, `before: ['status']`, `after: ['status', 'suspendedById', 'reason']`
   - `AUTH_USER_REMOVED: 'auth.user.removed'`, `before: ['status']`, `after: ['removedLabel']`

2. **Shim `before` support** (`2eb22c3`) — `createAuditLog` in `audit-logger.js` now accepts and passes through a `before` argument to `record()`. Prior to this, `before` was silently dropped; the catalogue's `REDACT` allow-list had already anticipated it for `ORDER_UPDATED`, `PHARMACY_ORDER_ACCEPTED`, etc.

3. **Order-progress audit** (`c81ff5f`) — `pharmacy-orders.service.js` regular status-update path (PROCESSING / SHIPPED / DELIVERED / READY_FOR_PICKUP / COMPLETED) now writes one audit event:
   - `PHARMACY_ORDER_FULFILLED` for COMPLETED/DELIVERED
   - `ORDER_UPDATED` for the intermediate statuses
   - `before: { status: order.status }`, `after: { status: updatedOrder.status }`
   Reject and cancel paths already had audit; the progress path did not.

4. **Auth-service audit events** (`b474340`) — four events wired, **fail-closed** (see §2):
   - `AUTH_ROLE_CHANGED` in `editPharmacyUser` when role changed
   - `AUTH_PIN_CHANGED` in `editPharmacyUser` when PIN set
   - `AUTH_USER_REMOVED` in `deletePharmacyUser` before delete
   - `AUTH_USER_SUSPENDED` in `suspendPharmacyUser` after update + bump

5. **Tests** (`6d31472` + part of `b474340`):
   - `tests/pharmacy-orders.test.js` +1 — `ORDER_UPDATED` on the progress path
   - `tests/auth-session-revocation.test.js` +2 — `AUTH_ROLE_CHANGED` and `AUTH_USER_SUSPENDED` with the correct `before`/`after` shapes

Actor attribution comes from `currentActor()` (middleware seeds it via `runWithContext`). The shim's `userId` argument is now redundant for callers inside a request; it remains supported as a fallback for background jobs and tests.

---

## 1. What P-05 did NOT ship (and who owns each)

| Deferred | Owner | Reason |
|---|---|---|
| Invite-flow audit (`auth.invite.sent`, `auth.invite.accepted`, `auth.user.activated`) | **P-06** | §5.2. The routes don't exist yet. The service methods will call `createAuditLog` the same way — follow the `suspendPharmacyUser` pattern. |
| Settings-change audit (`settings.limits.changed`, `settings.paused`) | **P-06** | §3.4/§5.8. `PharmacySetting` CRUD is P-06; add the audit call in the same PR. |
| `suspendPharmacyUser` route wiring | **P-06** | `POST /auth/users/:userId/suspend`. The service method already emits `AUTH_USER_SUSPENDED` — the route just exposes it. |
| `deletePharmacyUser` soft-delete audit refinement | **P-06** | Today it hard-deletes and emits `AUTH_USER_REMOVED`. P-06 replaces with `REMOVED` status; the event name stays, `after` gains `removedLabel` (already in the allow-list). |
| Admin actions audit | **Doc 3** | `ADMIN_LOGIN`, `ADMIN_ACTION` exist in the catalogue; the admin surface is Doc 3. |
| Bank audit — **fail-closed fix** | **P-08** | Banking audit calls (`BANKING_SETUP`, `BANKING_UPDATED`, etc.) are `FAIL_CLOSED` in the catalogue but wrapped in `.catch()` at the call site. **Same bug 5c fixed for auth.** P-08 must decide: remove `.catch()` (correct) or downgrade the actions from `FAIL_CLOSED` (honest but weaker). Flagged in §6. |
| Payout audit — same issue | **P-08** | Same pattern as banking. |

**None of these block P-05's exit test.** P-05 is "done" for the routes and services that exist today.

---

## 2. The fail-closed correction (5c) — read before touching these call sites

`catalogue.js`'s `FAIL_CLOSED` set includes `AUTH_ROLE_CHANGED`, `AUTH_PIN_CHANGED`, `AUTH_USER_REMOVED`, `AUTH_USER_SUSPENDED`. In `record()`, a fail-closed action **throws** on write failure, and the caller's transaction rolls back.

**But the initial 5c wiring wrapped every call in `.catch(err => console.warn(…))`** — matching the existing banking/order pattern. That catch swallowed the throw. **The action was fail-closed in name only.**

**5c was corrected before commit** — the `.catch()` was removed from all four calls. Now:
- A failed `AuditEvent` write on `AUTH_ROLE_CHANGED` propagates, `PATCH /auth/users/:userId` returns 500, the role change does not commit.
- Same for the other three.

**This is the correct behavior per Doc 1 §5.2, and it's the behavior the catalogue declares.**

**The existing banking and payout call sites still have the original `.catch()` pattern.** They are equally "fail-closed in name only". **Do not replicate 5c's mistake in P-06/P-07/P-08.** When wiring an audit call for a `FAIL_CLOSED` action, **do not add `.catch()`**. If the surface is too fragile for that (e.g., a checkout path where a transient audit failure would break a customer sale), **remove the action from `FAIL_CLOSED` in `catalogue.js`** and document why. Do not have a call site that contradicts the catalogue.

---

## 3. What did not change

- **No route file touched.** Snapshot stays at **131**. P-05 added no routes and removed none.
- **`authenticate()` untouched.** P-05 rides on the actor context FND-05b3 already seeds.
- **`prisma/migrations/` untouched.** No schema changes. `AuditEvent` is from `sec-02`.
- **`SEC_ENFORCE` untouched.**
- **No existing test changed in behavior.** `pharmacy-orders.test.js` already mocked `audit-logger`; adding one assertion didn't change the others. `auth-session-revocation.test.js` gained the `audit-logger` mock + 2 tests; the original 10 still pass.

---

## 4. Verified

**Tests as of `6d31472`:**

- Full suite: **260 passing / 34 suites / 1 pre-existing fail** (`src/test.js` orphan, out of scope).
- Two-gate: `route-policy` 5/5, `route-module-load` 13/13.
- New tests this phase:
  - `tests/audit-logger-shim.test.js` — 3 tests: shim passes `before` and `after` to `record()`; no-`before` still works; `before`-only still works.
  - `tests/auth-session-revocation.test.js` +2 tests: `AUTH_ROLE_CHANGED` with `{ role: 'STAFF' } -> { role: 'PHARMACIST', changedById: 1 }`; `AUTH_USER_SUSPENDED` with `{ status: 'ACTIVE' } -> { status: 'SUSPENDED', suspendedById: 1 }`.
  - `tests/pharmacy-orders.test.js` +1 test: `ORDER_UPDATED` on the CONFIRMED -> PROCESSING progress path, with the correct `entityId`, `before.status`, `after.status`.

**Structural verification (during the edits):**

- `catalogue.js`: 180 -> 187 lines (+7 for the three actions in `ACTIONS`, `REDACT`, `FAIL_CLOSED`).
- `audit-logger.js`: 237 -> 239 lines (+2 for `before = null` in the destructure and `before: before || undefined` in the event object).
- `pharmacy-orders.service.js`: 675 -> 683 lines (+8 for the progress-path `createAuditLog`).
- `pharmacy-auth.service.js`: 355 -> 388 lines (+33 for import + four audit calls; the `.catch()` removal is in-place, net 0 on those four lines).
- `pharmacy-orders.test.js`: 190 -> 203 lines (+13 for the one new test).

**No test now hits the real `AuditEvent` write for the paths P-05 added or modified:**
- `pharmacy-auth.service` tests mock `audit-logger`, so the four auth audit calls are absorbed.
- `pharmacy-orders.test.js` mocks `audit-logger`, so the progress-path audit call is absorbed.
- The pre-existing `pharmacy-orders.test.js` reject/cancel paths still hit the real audit path, as they did before P-05. That's the status quo, not introduced here.

---

## 5. Hand-off

**P-06** (invite flow, soft delete, suspend route, `LAST_MANAGER`, settings CRUD):

1. **`POST /auth/users/:userId/suspend`** — the service method `suspendPharmacyUser` already exists and already emits `AUTH_USER_SUSPENDED`. The route just calls it. **Do not add `.catch()` around the audit call; it's already there and fail-closed.**
2. **`POST /auth/invite/accept`, `POST /auth/users/:userId/invite`** — new actions needed: `AUTH_INVITE_SENT`, `AUTH_INVITE_ACCEPTED`. Add to `ACTIONS`, `REDACT`, `FAIL_CLOSED` in the same PR as the route. Follow the `AUTH_ROLE_CHANGED` pattern in `editPharmacyUser`.
3. **`deletePharmacyUser` soft delete** — replace the hard delete with `status: 'REMOVED'` + `removedAt` + `removedLabel`. The `AUTH_USER_REMOVED` event already exists; adjust `after` if needed (allow-list already has `removedLabel`).
4. **`GET/PATCH /pharmacy/settings`** — new actions: `SETTINGS_UPDATED`. `PharmacySetting` audit is high-value (limits changes affect abuse thresholds). Add to `ACTIONS`/`REDACT`/`FAIL_CLOSED` in the same PR as the routes.
5. **`POST /auth/manager/transfer`** — `team.transfer` capability + `AUTH_ROLE_CHANGED` (with a `reason: 'manager.transfer'` in `after` if the allow-list is extended).

**P-08** (bank protections) — see §2. `BANKING_*` actions are `FAIL_CLOSED` but `.catch()`-wrapped. This is a pre-existing inconsistency, not introduced by P-05. **P-08 must resolve it**, or the "fail-closed" label on banking is cosmetic.

**Doc 3** — `ADMIN_LOGIN`, `ADMIN_ACTION` already exist in the catalogue; no P-05 dependency. When Doc 3 wires admin audit, follow the same fail-closed pattern.

---

## 6. Lessons from this phase

**1. The `exit`-on-anchor-mismatch pattern closes the terminal.** In the first 5c edit attempt, the anchor check failed, `exit` fired, and the PowerShell window closed. The file was untouched — the write had not run — but the disruption was severe (the whole session is lost, and it happened to the same task twice). **Replacement pattern, used for the rest of P-05 with no further incidents:** wrap the entire write/verify/test body in `if ($ok) { … } else { Write-Host "ABORT — file unchanged." }`. A mismatch prints and skips; the prompt returns; nothing outside the `if` runs. This is now the standard for every edit block. It supersedes `P-04-status.md` §6.1's `$ok`-guard-with-`exit` recommendation, which is what caused the terminal to close.

**2. Line-number arithmetic is unreliable across edits, even within one phase.** Every anchor block in P-05 had at least one index off by one or more on the first attempt. The only reliable rule: **run a numbered `ReadAllLines` immediately before the edit**, use those indices verbatim, and never carry indices across a previous edit. Two examples this phase: the `editPharmacyUser` audit block (off by one on the `if (pin || …)` anchor) and the `pharmacy-orders.test.js` new test (off by one on the `expect(updateOrderStatus)` anchor). Both were caught by the safe pattern and fixed in a single retry.

**3. The fail-closed discrepancy in the existing codebase is real and pre-dates P-05.** Four banking call sites and four payout call sites (per `pharmacy-banking.service.js` and `pharmacy-payouts.service.js` from the earlier reads) wrap `FAIL_CLOSED` actions in `.catch()`. The catalogue's `FAIL_CLOSED` set is therefore a declaration of intent that the call sites silently violate. **P-05 fixed the four auth call sites it added.** It did not fix the pre-existing banking/payout ones because that's P-08's scope. **The status file records it so a future session doesn't rediscover it.**

**4. `createAuditLog`'s `before` parameter was silently dropped before P-05.** The `AuditEvent` schema and `record.js` supported `before`, and the catalogue's `REDACT` entries for `ORDER_UPDATED`/`PHARMACY_ORDER_ACCEPTED`/etc. declared `before: ['status']`, but the shim's destructure didn't list `before` and didn't pass it to `record()`. Any caller that passed `before` was silently ignored. **P-05 5b.1 fixed it.** `tests/audit-logger-shim.test.js` proves the round-trip. Future callers can pass `before` and it will be recorded.

**5. Full-suite pass count reconciled: 260 = 255 (pre-P-05) + 3 (audit-logger-shim) + 2 (auth-session-revocation) + 1 (pharmacy-orders) - 1 (`src/test.js` orphan excluded from the count).** No regressions, no skips, no silent test failures. The `src/test.js` orphan continues to fail as expected (pre-existing, out of scope).

---

## 7. FND-05 verification (post-ship)

**When:** recorded after P-05 shipped, during a review of Doc 2 §2.4's claim that "the `userId: null` in order events" was a data gap.

**Finding:** FND-05 was wired in `authenticate` at `src/middleware/auth.js:357`. It calls `runWithContext({ requestId, actor: { type, id, pharmacyId, role, sessionId, deviceId, ip, userAgent } }, () => next())`, which populates the AsyncLocalStorage context for every authenticated pharmacy request. `createAuditLog` at `src/utils/audit-logger.js:121` then checks `Boolean(currentActor())` and — when the context is populated — does **not** pass an actor override, so `record()` reads the actor from the context. **The three `userId: null` call sites in `pharmacy-orders.service.js` (lines 323, 366, 482 pre-cleanup) were cosmetic, not a data gap.** They were shadowed by the context and the audit rows already carried the real actor, role, session, IP, user agent, and request ID.

**Change made:**
- The three `userId: null,` lines were removed (replaced with a two-line comment pointing at this test) — no behavior change, just removing misleading code.
- New test `tests/create-audit-log-context.test.js` (3 tests) proves the mechanism: `userId: null` + populated context attributes via `currentActor()`; `userId: null` + no context falls to `'system'` (jobs / scripts, see `runAsSystem`); `userId: <id>` + no context uses the explicit override (legacy callers, if any remain).

**Remaining gap (documented, not a regression):** any service call to `createAuditLog({ userId: null })` that runs **outside** a request context — a cron job, an admin CLI, an internal script — writes `actorType: 'system'`, not a user. That is correct for those cases; jobs that need attribution must wrap their work in `runAsSystem(jobName, fn)` (see `src/core/context/actor-context.js`) or pass an explicit `userId`. Nothing in this codebase does that today, but a future background worker that calls `updateOrderStatus` or `bulkUpdateOrderStatus` directly would need to.

**P-05 done-when status:** Doc 2 §9.1 "Every state-changing pharmacy route writes one actor-attributed event; no event contains a PIN, token or full account number" — **met and verified**, with the caveat that jobs running outside a request context write `'system'` (which is the correct type for those, per Doc 1 §3.1).

**Documentation lesson:** the original status header said "closes automatically once FND-05 wires the request context" but did not record whether FND-05 *had* wired it. It had. The verification test and this section close that ambiguity. This is the first package where a stale line in the codebase was found to be harmless only after writing a test that proved it — a pattern worth applying to the remaining packages in waves 2B through 2E.