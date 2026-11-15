# P-01 Status -- Capability Decoration Phase (Doc 2)

**Branch:** `med-version`
**Tests:** 226 passing / 30 suites / 1 pre-existing FAIL (`src/test.js` -- orphan, out of scope). The route-module-load smoke test (`tests/route-module-load.test.js`, commit `f3100e4`) adds 13 file-load assertions that catch the class of bug that briefly took production down on 2026-11-15 (see section 7).
**Route-policy snapshot:** 131 entries remaining (down from 160 at P-02 start; 29 routes decorated).
**Production behavior:** unchanged. `SEC_ENFORCE=off`, all `requireCapability(...)` middleware short-circuits at the first line. The `log`/`enforce` flips are the deploy runbook's next step.
**Purpose of this document:** record what P-01 shipped, what it did not ship, and which package owns each remaining grandfathered route. It is the handoff artifact from P-01 to P-03 through P-10 and to the deploy runbook.

---

## 0. What P-01 shipped

Every pharmacy route that could be decorated with a one-line `requireCapability(...)` insert now carries a declared policy. Where a route was already `authorizeRoles('MANAGER')`, the new capability sits after the roles check and before the handler; user-visible behavior is unchanged because the underlying role gate was already there. Where a route had no role gate (`authenticatePharmacy` only), the new capability is the primary gate and every role that should reach it already holds the capability in `src/core/authz/capabilities.js`.

The route-policy CI test (`tests/route-policy.test.js`) enforces two invariants continuously:
- every mounted route is either in `tests/route-policies.grandfathered.json` or has a declared policy in its middleware chain;
- a route may not be in **both** (decorating means removing the snapshot entry in the same commit, by design of the test's "no grandfathered route has since gained a policy" check).

All 213 tests pass with the decorations in place.

---

## 1. Decorated routes (P-01)

| Route | Capability | Tier | Rate | Commit |
|---|---|---|---|---|
| `GET /api/pharmacy/banking/banks` | `banking.view` | T0 | read | 122294c |
| `GET /api/pharmacy/banking/status` | `banking.view` | T0 | read | 122294c |
| `GET /api/pharmacy/payouts/summary` | `payouts.view` | T0 | read | f768009 |
| `GET /api/pharmacy/payouts/history` | `payouts.view` | T0 | read | f768009 |
| `GET /api/pharmacy/orders/pending-payout` | `payouts.view` | T0 | read | f768009 |
| `GET /api/pharmacy/earnings/analytics` | `payouts.view` | T0 | read | f768009 |
| `POST /api/pharmacy/medications` | `inventory.edit` | T0 | write | 7bda85f |
| `PATCH /api/pharmacy/medications/:medicationId` | `inventory.edit` | T0 | write | 7bda85f |
| `PATCH /api/pharmacy/orders/bulk` | `orders.bulk` | T1 | bulk | 99006be |
| `GET /api/pharmacy/orders` | `orders.view` | T0 | read | 99006be |
| `GET /api/pharmacy/orders/:orderId` | `orders.view` | T0 | read | 99006be |
| `GET /api/pharmacy/medications` | `inventory.view` | T0 | read | 99006be |
| `GET /api/pharmacy/medications/catalog` | `inventory.view` | T0 | read | 99006be |
| `GET /api/pharmacy/profile` | `profile.view` | T0 | read | 99006be |
| `GET /api/pharmacy/dashboard` | `dashboard.view` | T0 | read | 6ed7643 |
| `GET /api/pharmacy/operating-hours` | `hours.view` | T0 | read | 6ed7643 |
| `POST /api/pharmacy/operating-hours` | `hours.edit` | T2 | write | 6ed7643 |
| `GET /api/pharmacy/users` | `team.view` | T0 | read | 6ed7643 |
| `PATCH /api/pharmacy/profile` | `profile.view` (coarse; see 4) | T2 | write | 6ed7643 |
| `POST /api/pharmacy/notifications/register` | `self.prefs` | T0 | device | 6ed7643 |
| `POST /api/pharmacy/push-tokens` | `self.prefs` | T0 | device | 6ed7643 |
| `DELETE /api/pharmacy/push-tokens/:token` | `self.prefs` | T0 | device | 6ed7643 |
| `POST /api/pharmacy/profile/logo` | `profile.logo` | T0 | upload | 6ed7643 |
| `POST /api/auth/add-user` | `team.manage` (coarse; see 4) | T2 | team | 4da09a8 |
| `PATCH /api/auth/users/:userId` | `team.manage` (coarse; see 4) | T2 | team | 4da09a8 |
| `DELETE /api/auth/users/:userId` | `team.manage` (coarse; see 4) | T2 | team | 4da09a8 |
| `PATCH /api/auth/change-password` | `self.pin.change` | T2 | pin_change | 4da09a8 |
| `GET /api/pharmacy/analytics` | `analytics.view` | T0 | read | 4101884 |
| `GET /api/pharmacy/analytics/weekly` | `analytics.view` | T0 | read | 4101884 |

Commit hashes are the med-version commits the decoration landed on.

---

## 2. Catalogue changes (P-01)

`src/core/authz/capabilities.js` was extended to add Doc 2 section 3.2 vocabulary without removing existing capabilities:

| Commit | Added to CAPABILITIES | Role grants |
|---|---|---|
| 813f74a (2a) | `payouts.view`, `sales.view.own`, `sales.view.all` | `payouts.view` and `sales.view.all` to MANAGER; `sales.view.own` to all four roles |
| c4e6b2b (3a) | `hours.view`, `hours.edit`, `self.prefs`, `self.pin.change` | `hours.view`, `self.prefs`, `self.pin.change` to all four roles; `hours.edit` to MANAGER only |

Pre-existing v1 capabilities were **not removed** (`payout.view`, `payout.history`, `earnings.view`, `sales.view`, `sales.export`, `inventory.delete`). Their reconciliation with Doc 2 section 3.2 belongs to P-06/P-08/P-09/P-10 (see 3) -- removing them today would silently drop capabilities from routes those packages own.

---

## 3. Remaining grandfathered routes, by owning package

The 131 routes still in `tests/route-policies.grandfathered.json` are **not** P-01 debt. Each belongs to a named package, and its snapshot entry is the correct "still to do" marker.

### P-01 follow-on (this doc, handler change)

| Route | Reason |
|---|---|
| `PATCH /api/pharmacy/orders/:orderId` | Doc 2 section 4.2: capability depends on target status. Requires dispatch inside the handler (`orders.progress`, `orders.handover`, `orders.decline`, `orders.cancel`), plus catalogue additions for `orders.progress` and `orders.handover`. |
| `POST /api/pharmacy/change-password` | Tombstone returning 410. To be declared `publicRoute(reason)` in the P-01 follow-on commit, not gated by capability. |

### P-03 (client contract / session routes)

| Route | Reason |
|---|---|
| `GET /api/auth/me` | Doc 2 section 4.1: gains `capabilities`, `limits`, `capVersion` in the response. Not capability-gated per route. |
| `POST /api/auth/refresh` | Session mechanism, not capability-gated. |
| `POST /api/auth/logout` | Session mechanism, not capability-gated. |

### P-04 (auth lifecycle)

| Route | Reason |
|---|---|
| `POST /api/auth/login` | Public; reason must be written when declared. Rate class `login`. |
| `POST /api/auth/register` | Public; reason must be written when declared. Rate class `register`. |

### P-07 (step-up, PIN hardening)

| Route | Reason |
|---|---|
| `POST /api/auth/step-up` | Doc 2 section 4.3 names P-07 as the owner. Capability would be a bare `self` (not yet in catalogue); P-07 also adds the `stepup` rate class. |

### P-08 (bank protections)

| Route | Reason |
|---|---|
| `POST /api/pharmacy/banking/setup` | T3 + pending-destination flow (section 6.1). |
| `PUT /api/pharmacy/banking/update` | T3 + pending-destination flow (section 6.1). |
| `POST /api/pharmacy/banking/verify` | T2 + throttle + lockout (section 6.1). |

### P-09 (POS rewrite)

| Route | Reason |
|---|---|
| `POST /api/pharmacy/sales` | Server-priced sale, idempotency, `SaleItem` normalisation. Capability is `pos.sell` -- not yet in catalogue. |
| `GET /api/pharmacy/sales` | Scoped by `cashierId` (added by P-09). Coarse decoration before P-09 would hide the field-level problem. |
| `GET /api/pharmacy/sales/export` | Catalogue reconciliation first: `sales.export` is currently on STAFF/PHARMACIST; section 3.2 says MANAGER-only. Needs its own small task. |

### P-10 (inventory integrity)

| Route | Reason |
|---|---|
| `DELETE /api/pharmacy/medications/:medicationId` | Becomes `inventory.archive` (section 6.4). Functional change, not decoration. |

### Doc 3 (admin surface)

All routes under `/api/admin/*` (63 entries). Also `POST /api/auth/admin/login` -- an admin login currently mounted on the pharmacy auth router; Doc 3 owns both the admin login route and its placement under `/api/admin/login`.

### Doc 4 (customer surface)

All routes under `/api/cart/*`, `/api/prescription/*`, `/api/refunds/*`, `/api/med-checkout/*`, `/api/med-confirmation/*`, `/api/med-track/*`, plus `/api/medications`, `/api/search`, `/api/medication-suggestions`, `/api/consent/*` (approximately 65 entries).

---

## 4. Known coarse decorations (to be refined)

Three decorations are deliberately coarser than Doc 2 section 3.2's target, because the finer capability is not yet in the catalogue or the handler refinement belongs to another package:

- **`PATCH /api/pharmacy/profile` to `profile.view`** (T2). Section 4.1 calls for `profile.edit.basic`; that capability is not yet in the catalogue. P-06 refines this and splits off the verified-field change-request flow.
- **`POST /api/auth/add-user` to `team.manage`** (T2). Section 3.2 splits `team.invite`, `team.role.change`, `team.suspend`, `team.pin.reset`. P-06 refines the split; today one coarse capability covers the three team routes.
- **`PATCH` and `DELETE /api/auth/users/:userId` to `team.manage`** (T2). Same split as above.

---

## 5. Next steps (section 9.4)

1. **Push `med-version` to origin** (deploys to Render automatically).
2. **Watch the boot log.** Confirm: split-secret fallback active, one DB connection, all crons started, no `ReferenceError`, no `requireCapability is not defined`.
3. **Flip `SEC_ENFORCE=log` on Render.** One env var, no code change. The deployment is safe because every route decorated so far is either already role-gated (`authorizeRoles`) or held by all four roles; the only route expected to produce shadow denies is `PATCH /orders/bulk` (no `authorizeRoles` today; only MANAGER holds `orders.bulk`).
4. **Watch 24h of `AuditEvent`** for `action = 'security.capability.denied'`. If a real workflow is being shadow-denied, fix the catalogue or the route's coarse capability before proceeding.
5. **Flip `SEC_ENFORCE=enforce` per group** using `SEC_ENFORCE_GROUPS` (section 9.4 rule 2 order: revenue/payouts/export reads, then bank, then inventory price/delete, then bulk and order cancel, then void/refund, then contact masking). Each flip is one env var. Rollback is `SEC_ENFORCE=off`.
6. **Then continue P-04, P-06, P-07, P-08, P-09, P-10** in the doc's section 9.2 wave order, each removing its routes from the snapshot in the same commit.

Deploy-specific details (SQL first, boot log, 24h watch) are in `DEPLOY_PHASE_1.md` sections 5 and 6; that runbook applies unchanged.

---

## 6. Lessons from this phase

**Two bugs that the test suite caught and the static analyzer could not.** Recorded here because the next session will hit the same class if it is not expecting it.

1. **`ROUTE_RE` end-of-line anchor under `/m`** (fix commit `6f8d33b`). The route-extraction regex used `$` as a lookahead alternative. With `/m`, `$` matched end-of-**line**, not end-of-string. For any route whose declaration spans multiple lines (`router.post('/profile/logo',` followed by middleware on subsequent lines), the non-greedy capture stopped at the end of line 1, leaving `rest` as `", "` and `chainNames` empty. `POST /profile/logo`'s decoration was invisible to the analyzer. Fix: `$` to `(?![\s\S])`, one-line change. Any future analyzer change should include a diagnostic against a known multi-line route in its verification.

2. **Missing import in a decorated file** (fix commit `4da09a8`). `src/routes/auth.js` did not import `requireCapability` when Task 4's script decorated four auth routes; `pharmacy.js` already did. Loading `auth.js` threw `ReferenceError: requireCapability is not defined` at the first decorated line, which caused `auth-error-contract.test.js` and `admin-registration-security.test.js` to fail (7 tests, 206/213 total). The static route-policy test passed throughout -- it reads source text without executing the module. The fix was one import line. Pre-flight for any future route-decorating task: run `node -e "require('./src/routes/<file>')"` before starting Jest. It takes one second and catches this class before the full suite runs.
   **Resolution (`f3100e4`):** `tests/route-module-load.test.js` now requires every file under `src/routes/*.js` in real Node before any push, with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY stubbed so the test answers "does the module graph load?" rather than "is this shell configured like production?". The route-policy test and this test check orthogonal properties (every route declared vs every file loads); neither substitutes for the other. Do not push a route file change until both are green.

**A third, less serious:** git's diff algorithm represents an insert-after-identical-line as `-old / +new` rather than a pure `+` in some cases (the `sales.view` to `sales.view` + `sales.view.own` insertion in 2a was one example; the `};` newline normalization was another). The verification rule "stat lines and grep line numbers must match expectation" catches this -- if the diff stat is off by one insertion, read the actual diff before committing.

---

## 7. Production incident -- 2026-11-15

At 10:53 UTC on 2026-11-15 the `med-version` deploy `9d1a032` failed at boot with:

```
ReferenceError: requireCapability is not defined
    at /opt/render/project/src/src/routes/pharmacy.js:52:52
==> Exited with status 1
```

**Root cause.** `src/routes/pharmacy.js` never imported `requireCapability`. Every decoration added to that file between P-01/2b and P-01/5a referenced a name that was not in scope at module load. The file had never been `require`d by any test: the route-policy test reads source text (no `require`), and no other Jest test loads `pharmacy.js`. The equivalent bug in `auth.js` (`4da09a8`) was caught because `auth.js` *does* have HTTP-level tests that load it. The asymmetry between the two files was the tell, and it was missed.

**Fix.** `b40aa3a` adds one import line. Service restored at 10:59 UTC (about 7 minutes of downtime).

**Why the earlier pre-flight missed it.** `P-01-status.md` section 6 lesson 2 recommended an ad-hoc `node -e require(...)` before Jest. That check would have caught the pharmacy.js bug if it had been run -- but it was a manual step, not a suite gate. Manual steps fail.

**Durable fix.** `f3100e4` adds `tests/route-module-load.test.js`: a child-process-per-file smoke test that requires every `src/routes/*.js` in real Node, stubbing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so the test answers "does this file load?" rather than "is this shell configured like production?". 13 new assertions, all green.

**The rule, for the next session:** any commit that touches a route file must hold both gates green before push -- `tests/route-policy.test.js` (every route declared) **and** `tests/route-module-load.test.js` (every file loads). Either gate alone is incomplete.
