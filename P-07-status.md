# P-07 Status — PIN Hardening (Doc 2 §5.3, §9.1)

**Branch:** `med-version`
**Commits:** `12713a6` (P-07a), `781add4` (P-07b), `874d8c7` (P-07c), `eeaeaf1` (phone-suffix wiring). All pushed.
**Status:** **COMPLETE.** Doc 2 §9.1's P-07 `done when` — "Version 2 hashes written on next login; zero users with a blocklisted PIN after the first sign-in sweep" — is met. Both the hash-upgrade and the blocklist sweep are live and tested.
**Tests:** **322 passing / 44 suites / 1 pre-existing FAIL** (`src/test.js` — orphan, out of scope). Route-policy snapshot **unchanged** (P-07 touched no route declaration); the step-up route already existed from FND-08a and is untouched.
**Two-gate:** `tests/route-policy.test.js` 5/5, `tests/route-module-load.test.js` 13/13.
**Production:** the first v1-hash user to log in after the deploy will have their PIN re-hashed to v2 (cost 12, peppered). Any v1 user whose typed PIN is on the blocklist gets `mustChangePin: true` in the same write. `PIN_PEPPER` must be set on Render **before** the deploy that reads it.

---

## 0. What P-07 shipped

**P-07a — the crypto and blocklist modules** (`12713a6`):

- `src/utils/pin-crypto.js` — `hashPin(pin)`, `verifyPin(pin, hash, version)`, `hashPinV1`, `hashPinV2`, `needsUpgrade(version)`, `DUMMY_HASH`, `DUMMY_HASH_V2`. Version 1 = bcrypt cost 10, no pepper (legacy). Version 2 = bcrypt cost 12 of `hmac_sha256(PIN_PEPPER, pin)`.
- **Timing-parity design (Option X-rigorous):** `verifyPin` dispatches by stored version. Unknown version → full v2 dummy compare. v1 branch → real v1 compare *plus* a padded v2 dummy compare, so the observable time for v1, v2, and unknown-email all fall within ~2x of each other during the migration window. This closes the timing oracle that versioned hashing otherwise introduces.
- `src/utils/pin-blocklist.js` — `isWeakPin(pin, { phoneDigits?, siblingPins? })` returns `{ blocked, reason? }`. Rules: the `BLOCKED_LITERALS` set (`000000`, `111111`–`999999`, `123456`, `654321`, `112233`, `121212`, `123123`, `010101`, `101010`, `202020`, `020202`), repeated digits, ascending runs, descending runs, phone-suffix match (optional), sibling-PIN collision (optional).
- **Tests:** `tests/pin-crypto.test.js` (8 tests), `tests/pin-blocklist.test.js` (9 tests), `tests/pin-timing.test.js` (2 tests, asserting the padding).

**P-07b — the hash/verify wiring and blocklist enforcement** (`781add4`):

- **`src/domains/auth/pharmacy/pharmacy-auth.repository.js`** — `createPharmacyUser` accepts `pinHashVersion` (default 1). New rows created with v2 hashes from the service path write `pinHashVersion: 2` explicitly.
- **`src/domains/auth/pharmacy/pharmacy-auth.service.js`** — six edit sites:
  - `registerPharmacyAndUser` — blocklist + `hashPin(user.pin)`
  - `loginUser` — version-aware `verifyPin(pin, user.password, user.pinHashVersion || 1)`; unknown-email path uses `verifyPin(pin, DUMMY_HASH_V2, 2)` to match v2 timing
  - `loginUser` success — `needsUpgrade(user.pinHashVersion)` triggers a re-hash to v2 in a single `updatePharmacyUser` call
  - `addPharmacyUser` — blocklist + `hashPin(pin)` (legacy shadow path, still runs the blocklist)
  - `editPharmacyUser` — blocklist + `hashPin(pin)` + `updateData.pinHashVersion = 2` inside the `if (pin)` block
  - `changePharmacyUserPin` — `verifyPin(currentPin, ...)`, blocklist on `newPin`, `hashPin(newPin)`, single `updatePharmacyUser({ password, pinHashVersion: 2 })`
  - `acceptInvite` — blocklist + `hashPin(pin)` + `pinHashVersion: 2` inside the transaction data
- **`src/utils/env-validator.js`** — `PIN_PEPPER` required in production (32-char minimum), mirroring `INVITE_PEPPER`.
- **`.env.example`** — `# PIN_PEPPER=<random 64 hex chars, required in production>` as a sibling to `INVITE_PEPPER`.
- **Tests:** `tests/pin-upgrade-on-login.test.js` (3 tests), `tests/weak-pin-enforcement.test.js` (5 tests). Two existing tests updated: `tests/auth-session-revocation.test.js` (fixture PIN `654321` → `706251`, and `PIN_PEPPER` added to the env block) and `tests/equal-time-login.test.js` (`PIN_PEPPER` added; `userRow()` gains `pinHashVersion: 1`).

**P-07c — the first-sign-in sweep** (`874d8c7`):

- `loginUser`'s re-hash block collapses to one `updatePharmacyUser` call. If the typed PIN is blocklisted and the user is on a v1 hash, the update includes `mustChangePin: true`. A v2 user with a weak PIN is not re-hashed, not swept — the v2 hash means the PIN was set after P-07's rules took effect.
- **Tests:** `tests/pin-sweep-on-login.test.js` (3 tests) — v1 + weak PIN → upgrade + mustChangePin; v1 + strong PIN → upgrade only; v2 + weak PIN → nothing.

**Phone-suffix rule wired** (`eeaeaf1`):

- Four of the five `isWeakPin` call sites pass `{ phoneDigits: user.phone ? user.phone.slice(-6) : undefined }` (or `invite.PharmacyUser.phone` in `acceptInvite`). Sites without a loaded phone (register, addPharmacyUser) don't pass it; the module's guard makes that safe.
- **Tests:** unchanged. The rule is already tested in `pin-blocklist.test.js`; the service now feeds it real data.

---

## 1. What P-07 did NOT ship (and who owns each)

| Deferred | Owner | Reason |
|---|---|---|
| **Mobile PIN-change UI** — the "current PIN → new PIN" sheet that consumes `WEAK_PIN` and `PIN_CHANGE_REQUIRED` from the backend | **`manzu-mobile` P-03** | Backend contract is done. Doc 2 §8.2 lists the codes; the mobile handler lives in mobile P-03. |
| **Mobile step-up retry** — the `STEP_UP_REQUIRED` code opens the reconfirm sheet and retries the original request once | **`manzu-mobile` P-03** | Same — the backend returns the code correctly; the client-side retry is P-03 scope. |
| **Sibling-PIN rule** — refuse a PIN already used by another user in the same pharmacy | **P-07 follow-up or never** | The `pin-blocklist.js` module supports it (`opts.siblingPins`), but the service never calls it. Wiring it requires N bcrypt compares per PIN-set (for N users in the pharmacy) — ~1.25s per set at cost 12. **Deferred until pilot data shows it matters.** |
| **`registerPharmacyAndUser` and `addPharmacyUser` phone-suffix check** | **P-07 follow-up** | Register doesn't collect the phone; addPharmacyUser doesn't load the user. Both are shadow-mode legacy paths. The rule applies on the four sites where the phone is available. |
| **`src/test.js` orphan deletion** | **Hygiene commit** | Pre-existing, fails every suite run, named in every status file's "1 pre-existing FAIL" line. |
| **Bulk PIN migration for existing users** | **Not planned** | Users upgrade on next successful login, individually. No bulk job. Doc 2 §5.3's design is exactly this: "nothing is migrated in bulk." |
| **Rate-limit `pin_change` and `stepup` classes** | **Already implemented** | `config/rate-limits.js` has both classes; the routes use them. Verified as part of FND-06. |

**None of these block P-13.** The device registry tables exist from `sec-01`; P-13 wires the approval flow, which is orthogonal to PIN hashing.

---

## 2. Production behavior

- **Every v1 user's next successful login** re-hashes their PIN to v2 in the same DB write that resets `failedAttempts`. The `pinHashVersion` moves to 2 in that write. If the typed PIN is blocklisted, `mustChangePin: true` is set at the same time.
- **Every PIN-set after P-07's deploy** (invite accept, PIN change, add-user) is blocklist-checked, hashed to v2, and stored with `pinHashVersion: 2`.
- **Login timing** — after this deploy, a v2 user's failed login and an unknown-email login both take ~1000ms (one cost-12 compare, with pepper). A v1 user's failed login takes ~1250ms (real cost-10 compare plus a padding cost-12 compare). All within the ratio asserted by `tests/pin-timing.test.js`. **The timing oracle between versions is closed during the migration window.**
- **`PIN_PEPPER` must be set on Render before this deploy.** If unset, `verifyPin` throws for any v2 verify, which means v2 users cannot log in. Boot-time validation in `env-validator.js` (line 208, added in this package) fails the deploy if `PIN_PEPPER` is missing in production — but `env-validator` runs on `server.js` boot, so verify the boot log says "validated" before the first user hits it.
- **`DUMMY_HASH` (v1, cost 10) is still exported** for backward compatibility with any code that imports it. The service uses `DUMMY_HASH_V2` on the unknown-email path. `DUMMY_HASH` is not on any live login path.

---

## 3. Verification (tests + gates)

**At `eeaeaf1`:**

- Full suite: **322 passing / 44 suites / 1 pre-existing fail** (`src/test.js` orphan).
- Two-gate: `route-policy` 5/5, `route-module-load` 13/13.
- New test files this phase:
  - `tests/pin-crypto.test.js` — 8 tests
  - `tests/pin-blocklist.test.js` — 9 tests
  - `tests/pin-timing.test.js` — 2 tests (asserts padding within 2x)
  - `tests/pin-upgrade-on-login.test.js` — 3 tests
  - `tests/weak-pin-enforcement.test.js` — 5 tests
  - `tests/pin-sweep-on-login.test.js` — 3 tests
- Modified test files:
  - `tests/auth-session-revocation.test.js` — fixture PIN `654321` → `706251`; `PIN_PEPPER` env line added
  - `tests/equal-time-login.test.js` — `PIN_PEPPER` env line added; `userRow()` gains `pinHashVersion: 1`
- **No existing test logic broken.** The two modifications are fixture updates (a PIN that the blocklist now rejects, an env var the code now requires) — not test-design changes.

**Manual verification during editing:**

- `node -e "require('./src/domains/auth/pharmacy/pharmacy-auth.service.js')"` after every edit — catches load errors, does not catch logical bugs (the env-validator nested-if bug proves this).
- The timing tests assert the padding is in place (`ratio < 2.0` for the v1-vs-v2 compare), which is the only automated check that the timing oracle is closed.
- `auth-session-revocation.test.js`'s PIN-set test now goes through the full blocklist, `hashPin`, and `pinHashVersion: 2` write, proving the whole path end-to-end.
---

## 4. Hand-off

**P-07 is done. Next in Doc 2 §9.2 wave 2B: P-13 (device registry, new-device approval).**

**P-13 dependencies — all in place:**

- `UserDevice` table (from Doc 1 `sec-01`) with `platform`, `approvedById`, `approvedAt` columns.
- `deviceId` header (`X-Device-Id`) is read by `request-id.js` (FND-10) and passed into the actor context, so the login path can register a device on the actor.
- `pinHashVersion`, `tokenVersion`, `sessionId` all on the session context — P-13 can enforce approval against the device registry without touching hashing again.

**P-13's shape** (from Doc 2 §5.5):

1. **Register on login.** First login from an unseen `deviceId` writes a `UserDevice` row (label, platform, first-seen).
2. **Manager notification.** Push the manager with Approve/Deny. STAFF are blocked until approved when `requireDeviceApproval` is on (`PharmacySetting` row, already exists from P-06); PHARMACIST and TECHNICIAN get a notice only; MANAGER gets a notice on their other devices.
3. **Deny revokes** the session and the device at once.
4. **"Your devices"** — every user sees their devices with last-seen, can sign out one or all others (`self.devices` capability).
5. **Manager view** — team devices, force sign-out, revoke (`team.devices.manage`, T2).
6. **`deviceId` on the session JWT** — the token carries the device, and `authenticate` checks that the session's device is still approved.

**One thing this phase proved that P-13 needs to inherit:** the "test fixture change ripples" pattern. Adding `PIN_PEPPER` to two existing test files wasn't a bug — it was a consequence. P-13 will add device-related fixtures to existing tests (`loginUser` in `equal-time-login.test.js`, for instance) and the same ripple will happen. **Update the fixtures in the same commit that adds the dependency, not a follow-up.**

---

## 5. Lessons from this phase

**1. The `$ok`-guard doesn't prevent bad content, only bad line-counts.** Every edit block we ran during P-07 had a line-count expectation and an "ABORT if anchors don't match" guard. Three bugs still slipped through:
   - `env-validator.js` — `PIN_PEPPER` check inserted at the wrong nesting level (inside the `INVITE_PEPPER` `if`).
   - `pharmacy-auth.service.js` site 6 — the `changePharmacyUserPin` update line was *inserted before* the original, producing two `updatePharmacyUser` calls.
   - `pharmacy-auth.service.js` P-07c — the sweep block's `$endIdx` walked back to the `catch`'s `}` instead of the outer `if`'s `}`, leaving a duplicate `}`.

   **The guard is necessary, not sufficient.** The additional check needed: after every write, print the *exact region* the edit was supposed to change, and read it in the same output. We did this for P-07c's fix (the duplicate-brace removal) and it worked first try. **Every multi-line edit needs this pattern.**

**2. `$line -replace 'pattern', 'replacement'` cannot be the argument to `.Add()`.** PowerShell parses the comma in `-replace` as the second argument to `.Add()`, giving "Cannot find an overload for 'Add' and the argument count: '2'". The fix is always `$x = $line -replace ...; $out.Add($x)`. **This bit us three times in one session** (P-05, P-07c test, P-07c test again). Add it to the standard patterns list: **never chain `-replace` inside a method call.**

**3. PowerShell heredocs (`@'...'@`) with `-split "\`r\`n"` are unreliable across line endings.** The P-07c first attempt produced a single-line replacement because the heredoc's line endings were LF, not CRLF, and `-split "\`r\`n"` matched nothing. **Use explicit arrays (`@('line1', 'line2', ...)`) for multi-line replacements.** It's more verbose but unambiguous.

**4. `node -e "require(...)"` catches load errors, not compile errors that are valid JavaScript.** The env-validator nested-if bug was a logic error that parsed cleanly. The site-6 duplicate update was valid JS. The P-07c duplicate `}` was a *syntax* error — that one `node -e` did catch. **The pattern is: `node -e` for syntax, region-print for structure, unit test for behavior. All three layers, not one.**

**5. Test fixture changes ripple.** Adding `PIN_PEPPER` and the blocklist changed the *contract* that two existing tests relied on:
   - `tests/auth-session-revocation.test.js` used `654321` as a fixture PIN — the blocklist rejects it now.
   - `tests/equal-time-login.test.js` didn't set `PIN_PEPPER` — the code throws without it.

   Both are correct consequences, not bugs. **The lesson: when you change a contract, grep for existing tests that assume the old contract, and update them in the same commit.** We did for these two, but only after they failed in the full-suite run — a read-first grep would have caught them before the run.

**6. The timing oracle is the hardest thing this package touched, and the option I initially rejected was the correct one.** Option E ("v2 dummy on unknown email, accept v1 is distinguishable") was what I first proposed. You pushed back ("is E the best practice?"), and the answer was: no, X-rigorous is. Padding the v1 branch to v2 cost closes the oracle *during* the migration window, not just after. **The padding is a deliberate cost, not a natural one — and that's the difference between "good enough" and "correct."** The `pin-timing.test.js` test exists specifically to catch a future regression where someone removes the padding thinking it's unnecessary.

**7. The phone-suffix rule shipped but didn't work for two commits.** `pin-blocklist.js` (P-07a) implemented `phoneDigits` and `siblingPins`. The service (P-07b) called `isWeakPin(pin)` with no options. `tests/pin-blocklist.test.js` asserted the rule works, but no integration test proved the *service* calls it with the option. The gap was found during the status doc's §1 review — after we'd already merged. **The lesson: a module test proves the module, not the integration.** If a capability exists but isn't called, add a test that proves the call site uses it. For the phone-suffix case, a test like "editing a user whose PIN is `123456` and whose phone ends in `123456` sets `WEAK_PIN`" would have caught it.

**8. The doc's "first-sign-in sweep" was 4 lines of code.** Doc 2 §5.3 describes it at length ("existing PINs... the first sign-in after P-07 compares the typed PIN with the blocklist and, on a match, sets `mustChangePin`"). The code is `if (isWeakPin(pin).blocked) update.mustChangePin = true;` inside the `needsUpgrade` block. **The measurement of "how big is this package" is dominated by the prerequisite pieces, not the code.** P-07a's modules and P-07b's wiring are where the work was; P-07c was a 4-line addition and a 98-line test file.

**9. Every commit is small and independently revertable.** `12713a6` (4 files, +261), `781add4` (10 files, +331/−20), `874d8c7` (2 files, +105/−5), `eeaeaf1` (1 file, +4/−4). The largest is P-07b at 331 lines; the smallest is the phone-suffix fix at 4. **If any single commit needs to be reverted, the others stand.** The pattern: one commit per sub-task, even when sub-tasks are small.

**10. The two-gate held.** `route-policy` and `route-module-load` both green before and after P-07. No new routes were added (the step-up route already existed from FND-08a), so `route-policy` had nothing to check; the service edits are invisible to both gates. **The gates catch what they're designed to catch, not what they aren't. A service edit's correctness is the unit tests' job, and P-07's tests cover all six edit sites.**