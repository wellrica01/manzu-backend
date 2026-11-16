# P-03 Status — Actor Payload (Doc 2 §3.5, §9.1)

**Branch:** `med-version`
**Commits:** `729cc97` (P-03a), `6191db4` (P-03b). Both pushed.
**Status:** **BACKEND COMPLETE.** The mobile half of P-03 (§8.1–8.2: navigation, guards, error codes, headers) is in `manzu-mobile`, separate repo. Doc 2 §9.1's P-03 `done when` — "Section 4 table enforced; STAFF gets 403 on revenue, payouts, export, price edit, delete, bank; each capability group has a flag" — depends on P-01 (enforcement, shipped) and on the mobile half, which is not yet built.
**Tests:** **289 passing / 37 suites / 1 pre-existing FAIL** (`src/test.js` — orphan, out of scope). Route-policy snapshot **unchanged** (131 remaining); P-03 only enriches three responses, no new routes.
**Two-gate:** `tests/route-policy.test.js` 5/5, `tests/route-module-load.test.js` 13/13.
**Production:** the three routes return the new fields as of the merge; mobile clients that don't read them are unaffected (additive, backward-compatible).

---

## 0. What P-03 backend shipped

**P-03a — actor-payload helper** (`729cc97`):
- `src/domains/auth/pharmacy/actor-payload.js` — one exported async function, `buildActorPayload(user, pharmacy)`, plus a frozen `LIMIT_FIELDS` array.
- **Contract:** returns `{ capabilities: string[], limits: object, capVersion: string }`.
- **`capabilities`** — `ROLE_CAPABILITIES[user.role]` from `src/core/authz/capabilities.js`, sorted lexicographically. Unknown roles (`OWNER`, `ADMIN`) yield `[]` — consistent with the enum freeze in Doc 2 §3.1.
- **`limits`** — exactly the seven numbers from `PharmacySetting` per Doc 2 §3.4: `discountCapPct`, `voidWindowMinutes`, `adjustThresholdUnits`, `adjustApprovalUnits`, `priceChangeCapPct`, `refundLimitKobo`, `bankHoldHours`. Not the booleans or audit columns — the mobile app reads those via `GET /pharmacy/settings`, not auth responses.
- **`capVersion`** — `sha256(JSON.stringify({capabilities, limits})).slice(0, 16)` — 16 hex chars, changes whenever a role's capability set or a limit changes. The mobile client compares this against its cached version and clears cached data on mismatch (Doc 2 §3.5).
- **Fail-closed on missing field:** if `getSettings` does not return one of the seven `LIMIT_FIELDS`, `buildActorPayload` throws. Silent `undefined` would make `capVersion` stable but wrong — the mobile client would never invalidate, and the manager's configured cap would be silently ignored. Throwing forces whoever edits `LIMIT_FIELDS` to update both sides.
- **Tests:** `tests/actor-payload.test.js`, 7 tests — MANAGER set contents, STAFF set contents, unknown-role empty array, the exact seven limit fields, `capVersion` hex format, stability across identical calls, change between MANAGER and STAFF.

**P-03b — three routes wire the helper** (`6191db4`):
- `GET /auth/me` in `src/routes/session.js` — `const payload = await buildActorPayload(me.user, me.pharmacy); res.status(200).json({ ...me, ...payload });`
- `POST /auth/refresh` in `src/routes/session.js` — same pattern, spread onto the existing `{ message, token, refreshToken, user, pharmacy }`.
- `POST /auth/login` in `src/routes/auth.js` — same, spread into the existing response object.
- Top-level spread, so `{ user, pharmacy }` destructuring in existing clients keeps working. Three new sibling keys are added; nothing removed or renamed.
- **Tests:** one new test per route file (`tests/session-routes.test.js` — 11 total, `tests/auth-error-contract.test.js` — 6 total). The `auth-error-contract` test asserts `capabilities` contains `team.invite` for a MANAGER, proving the real `ROLE_CAPABILITIES` wiring is on the hot path, not just that the field exists.

---

## 1. What P-03 did NOT ship (and who owns each)

| Deferred | Owner | Reason |
|---|---|---|
| **Mobile P-03** — session store, `useCan` hook, tab gating via `href: null`, `RequireCapability` guard, error-code handlers (Doc 2 §8.1–8.2), headers `X-App-Version` / `X-Device-Id`, `APP_UPDATE_REQUIRED` gate | **`manzu-mobile`** | Separate repo. Now unblocked by P-03 backend. |
| **`POST /auth/challenge` + step-up T3 signature verification** (Doc 2 §5.6) | **P-16 backend** | The challenge route does not exist. P-03 makes it possible for the client to *know* it holds T3-gated capabilities, but nothing yet enforces T3 signatures. |
| **`src/test.js` cleanup** — delete the empty test file | **Hygiene** | Pre-existing. Named in every P-XX status file's "1 pre-existing FAIL" line. Deleting it is a one-line PR that closes a recurring wart. |
| **`settings.service.getSettings` per-process cache** | **Only if `/me` becomes hot** | Today every `/me`, `/login`, `/refresh` call adds one `PharmacySetting.findUnique`. For a pharmacy with 5 active users, ~20 extra reads/hour. Trivial. The fix (a per-process cache keyed by `pharmacyId`, invalidated by `PATCH /pharmacy/settings`) is P-06 scope if it ever matters. |
| **`capVersion` as a signed/versioned token** | **If a replay attack emerges** | Today it's a hash — anyone with the last 16 chars of the sha256 cannot derive the inputs but can cache a stale copy. The mobile client is the only consumer, and it compares stored vs returned. No known attack surface. |

**None of these block mobile P-03 or P-14.** P-03's mobile dependencies (`/auth/me`, `/login`, `/refresh` return the three fields) are met. P-14's dependency (`capVersion` is real, not a placeholder) is met.

---

## 2. Production behavior

- **The three routes return the three new fields** as of commit `6191db4` merged to `med-version` and deployed to `manzu-backend.onrender.com`.
- **No behavior change for existing clients.** The response is additive: `{ user, pharmacy }` is still present alongside the new keys. Old mobile builds destructure `{ user, pharmacy }` and ignore the rest — verified against `tests/session-routes.test.js`'s existing success test, which still passes.
- **`/auth/me` is called on app foreground** (Doc 2 §3.5); each call adds one `PharmacySetting` read. Documented in §1 as a hot-path concern only if traffic changes.
- **`capVersion` stability** — same role + same `PharmacySetting` row → same hash. A manager editing `discountCapPct` changes the hash, which invalidates every mobile client's cached query data on the next `/me`. That is the intended behavior, not a bug.

---

## 3. Verification (tests + gates)

**At `6191db4`:**

- Full suite: **289 passing / 37 suites / 1 pre-existing fail** (`src/test.js` orphan). Up from 287 at P-03a start; +2 from the two route tests.
- Two-gate: `route-policy` 5/5 (131 grandfathered routes unchanged), `route-module-load` 13/13.
- New test files this phase: `tests/actor-payload.test.js` (7 tests).
- Modified test files: `tests/session-routes.test.js` (+1 test, 11 total), `tests/auth-error-contract.test.js` (+1 test, 6 total).
- **No existing test broke.** The two route files were updated to add the `settings.service` mock — required because `routes/session.js` and `routes/auth.js` now transitively require `actor-payload` → `settings.service` → `prisma`. Without the mock, both test files would fail at `require` time. This is why P-03b was **one commit** for four files, not two separate commits.

**Manual verification during editing:**

- `node -e "require('./src/routes/session.js')"` — loads with the full middleware chain (expected DB connect during require).
- `node -e "require('./src/routes/auth.js')"` — same.
- The `auth-error-contract` test's `team.invite` assertion is the strongest single signal that `ROLE_CAPABILITIES` wiring is live, not a mock.

---

## 4. Hand-off

**P-03 backend is done. The package's remaining scope is mobile.** Doc 2 §9.2's wave 2A (P-01 through P-05) is now down to P-05 (actor on every audit event) — P-01 through P-04 are shipped except for P-04's status doc if not yet written.

**Mobile P-03's dependencies — all in place:**
- `/auth/me`, `/auth/login`, `/auth/refresh` return `{ user, pharmacy, capabilities, limits, capVersion }` (from `6191db4`).
- `ROLE_CAPABILITIES` is the source of truth for role → capability mapping (unchanged since P-01; the freeze on `OWNER`/`ADMIN` from Doc 2 §3.1 means empty arrays for those, which is correct).
- Error codes the mobile side needs (`FORBIDDEN_CAPABILITY`, `STEP_UP_REQUIRED`, `RATE_LIMITED`, etc.) are all defined by the server today per Doc 2 §8.2's "Codes already defined in Doc 1" list.
- `capVersion` is real (not a placeholder) — P-14's cache allowlist can be built against it.

**Mobile P-03's shape** (from Doc 2 §8.1–8.2):
1. Session store reads the three fields and persists with the session in SecureStore.
2. `useCan('capability')` replaces role checks; `isManager` stays as a thin alias during migration.
3. Tab gating via `href: null` — hide tabs the user can't use, don't render dead screens.
4. `RequireCapability` guard on every screen under `src/app/(app)/` that needs a capability — covers deep links and push taps.
5. On `FORBIDDEN_CAPABILITY`: refetch `/me`, rebuild navigation, show message. Server wins.
6. Send `X-App-Version` and `X-Device-Id` on every request; honour `X-Min-App-Version` with a blocking update screen.
7. Error-code handlers for all 19 codes in Doc 2 §8.2.
8. The existing one-retry-on-401 in `client.ts` must not swallow `ACCOUNT_SUSPENDED` or `SESSION_REVOKED` — those end the session immediately.

**One gap that matters:** the mobile half must be built against `X-Min-App-Version` compatibility. Old mobile builds that don't yet read the three fields must continue to work — they do, because the response is additive. But when the mobile half lands, it must be the **first build** that *needs* the fields. If an older build is still in the field, the `X-Min-App-Version` gate handles the upgrade prompt, but it doesn't force every pharmacy to update simultaneously. Doc 2 §9.4 step 3 sets the enforcement gate at ">90% of active devices on a build that understands the new codes" — that is the trigger.

**The other hand-off — Doc 2 §9.7 to the Offline Capability plan:** the `capVersion` field is one of the four constraints that plan needs (Doc 2 §9.7 item 4 — "Capabilities are cached with an expiry and `capVersion`. A user suspended while offline will have queued actions refused on replay…"). With P-03 backend shipped, that constraint is real, not aspirational.

---

## 5. Lessons from this phase

**1. The `$ok`-guard + "write inside `if ($ok)`" pattern held across both edits.** The PowerShell block for P-03b.1 had a doubled `$new = New-Object` list — the first draft's content was discarded when the second `$new` was initialized, and the output file was still correct. But that was luck: the second `$new` happened to be initialized before any of the first `$new`'s content was used. The pattern that *actually* held was the anchor check + `if ($ok)` guard, which never gave the block a chance to write a broken file. **A block with a sloppy draft can still be safe if the guard is in place; a block without the guard can be broken even when the content is right.**

**2. Trust the file, not the transcript's claims about the file.** The transcript asserted `mockLogin` was the mock variable name in `auth-error-contract.test.js`. Reading the file confirmed it at line 12, `const mockLogin = jest.fn();`. But reading was necessary — if the mock had been named `mockLoginUser`, the test would have failed at `mockLogin is not defined`, and the failure would have pointed at a name typo in a block we thought was verified. **Every edit block should include a read that confirms its own anchors against the current file, not against the transcript's summary of the file.** This mirrors P-06 §5.1's "never reconstruct from memory" — same lesson, one level deeper.

**3. Jest mock hoisting must be present in every test file that transitively requires the changed module.** `routes/session.js` and `routes/auth.js` now both require `actor-payload` → `settings.service` → `prisma`. Any test file that `require`s either route now pulls in the settings service; without a `jest.mock('../src/domains/pharmacy/settings/settings.service', ...)`, the file fails at module load with a Prisma error. **This is why P-03b was one commit, not two:** the routes without the mocks would have broken every existing test in those files. The commit boundary is the *contract* boundary, not the *file* boundary.

**4. `src/test.js` is empty and fails the suite — pre-existing, out of scope.** Every P-XX status file's "1 pre-existing FAIL" line names it. The fix is a one-line `Remove-Item tests/test.js` or `git rm src/test.js` (whoever added it will know which path is correct — P-01 through P-06 status files all reference it as `src/test.js`). **Recording it here rather than deleting it is deliberate** — a future hygiene commit can cite this status file as the origin, and the reference survives.

**5. The `limits` throw-on-missing-field pattern is a deliberate choice, not an oversight.** The alternative — let `undefined` through — would make `capVersion` stable but wrong. A manager editing `discountCapPct` from 0 to 15 changes `limits.discountCapPct` but, if `getSettings` returned `undefined` for that field, `JSON.stringify` would omit it and the hash would be stable. The mobile client would never invalidate, and the cap change would silently not reach the UI. Throwing forces the next person editing `LIMIT_FIELDS` to update both the helper and the settings service. **The pattern to prefer in future additions: fail loudly at the boundary between two modules that must stay in sync.**

**6. The two-gate held every time.** `route-policy` (5/5) and `route-module-load` (13/13) both green before and after P-03. No new route was added — the three routes only changed their response shape — so the route-policy snapshot stayed at 131. The two-gate catching *response shape* isn't its job; that's what the route tests in `session-routes` and `auth-error-contract` do. **This phase is the first one in the project where the two-gate ran but didn't catch anything, because the change was inside a route's body, not its declaration.** The route tests are the layer that catches a response-shape regression; the two-gate catches a route-declaration regression. Both are necessary; neither is sufficient.

**7. Every commit is small and independently revertable.** `729cc97` (2 files, +132), `6191db4` (4 files, +65/-3). Both under 200 lines of diff. The `session.js` change touches two handlers in one file; `auth.js` touches one. If either commit needs to be reverted, the other still stands. **The pattern to prefer: one commit per sub-task, even when the sub-tasks are shipped back to back.**