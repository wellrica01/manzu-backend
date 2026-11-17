# P-13b Status — Device-approval gate (Doc 2 section 5.5, section 9.1)

**Branch:** `med-version`
**Commits:** `32f9341` (settings default flip), `bf9cdff` (the gate). Plus
`3f6a954` (P-07 status, docs only) and the earlier FND-09 device-registry
work. All on `med-version`.
**Status:** **COMPLETE for P-13b.** P-13a was already shipped by FND-09
(`c6de91e`) — see section 1. P-13c (routes, audit, manager notification)
is NOT in this commit, and the gate is dark until P-13c exists — see
section 2.
**Tests:** **329 passing / 45 suites / 1 pre-existing fail** (`src/test.js`
orphan). New: `tests/device-approval-gate.test.js` (6),
`tests/error-contract.test.js` (+1 enumeration), `tests/settings.test.js`
(assertion flip). Two-gate (`route-policy`, `route-module-load`) unchanged
and green; P-13b added no route.
**SEC_ENFORCE:** set to `enforce` in the working environment. The gate is
live as soon as `sec-06` runs and a pharmacy setting is `true`; the released
mobile build sends no `X-Device-Id`, so it is never gated. See section 2.

---

## 1. What P-13 actually shipped

The Doc 2 section 5.5 package is three parts, and only one of them is this
commit.

**P-13a — already done by FND-09 (`c6de91e`).** Registration, `X-Device-Id`
threading, refresh re-registration, `trusted:false` on insert, best-effort
upsert, released-build no-op. Evidence: `tests/device-registry.test.js`,
`pharmacy-session.repository.js:80-100`, `session-service.factory.js:74-90`.
No new work in P-13b for this part.

**P-13b — this commit (`bf9cdff`, plus `32f9341`).**
- `32f9341`: `PharmacySetting.requireDeviceApproval` schema default
  `true -> false`; `settings.service.js` DEFAULTS map `true -> false`;
  `sec-06-pharmacy-device-approval.sql` (column default `false`, existing
  rows normalised). Owner runs `sec-06` before the merge.
- `bf9cdff`: `loadPharmacyActor` gains `device_approval_required`
  (`COALESCE(..., false)` for a pharmacy with no settings row) and
  `device_ok` (no header, or a trusted and unrevoked device, or the user's
  first-seen device). `authenticate` denies with
  `DEVICE_APPROVAL_REQUIRED` after the PIN-change check.
  `httpStatusFor` maps both new codes to 403. `codes.js` registers both
  codes. Five device methods in `pharmacy-session.repository.js`
  (`findDevice`, `listDevicesForUser`, `approveDevice`, `denyDevice`,
  `revokeDevice`) and a `platform` write in `upsertDevice`.
  `tests/device-approval-gate.test.js` (6 cases),
  `tests/error-contract.test.js` enumeration test, `tests/settings.test.js`
  assertion flip.

**P-13c — not shipped.** The five routes (`GET /auth/devices`,
`DELETE /auth/devices/:id`, `GET /pharmacy/team/devices`,
`POST /pharmacy/team/devices/:id/approve`, `/deny`), the
`src/domains/pharmacy/devices/` service, the route-policy entries, the
audit events, and the manager push. Until P-13c, the gate can block a
device that cannot be approved — section 2 states the consequence.

---

## 2. Production behaviour, deploy sequence, and the three-key safety

The gate is now in the codebase and, under `SEC_ENFORCE=enforce`, it is
live as soon as two conditions hold: `sec-06` has run, and a pharmacy's
`requireDeviceApproval` is `true`. It affects a request only when a third
condition holds: the client sends an `X-Device-Id`.

That is the **three-key safety**: backend `sec-06` run + pharmacy setting
`true` + client sends a device id. Any one missing, the gate is inert.

**Deploy sequence:**
1. Owner runs `sec-06` before any merge to production. If it does not run,
   existing `PharmacySetting` rows that carry `true` stay `true`, and any
   pharmacy that has one is gate-live with no approval UI (P-13c does not
   exist yet).
2. **Do not flip `requireDeviceApproval = true` on any pilot pharmacy**
   until P-13c ships the approve/deny endpoints and the manager
   notification. The default is `false`; leaving it there is correct until
   P-13c lands.
3. The released mobile build is safe: it sends no `X-Device-Id`, so
   `device_ok` is `true` and the gate is skipped. The gate is dark for the
   current build in the field.

**Opt-in posture:** the gate is a hardening control a manager turns on. The
schema default, the settings-service default, and the SQL default are all
`false`, and `sec-06` normalises existing rows to `false`. A pharmacy flips
it with `PATCH /pharmacy/settings`. The flip is audited
(`SETTINGS_UPDATED`).

---

## 3. Decisions recorded

**P-D6 — header-only device identity.** The gate reads
`req.client.deviceId`, which `request-id.js` validates against
`/^[A-Za-z0-9_-]{1,64}$/`. `deviceIdFromRequest` (the legacy registration
path) still reads `req.body.deviceId || X-Device-Id`, so a client can
register under a body value. That is fine for registration; the gate never
reads the body. A test (`gate uses req.client.deviceId, not
body.deviceId`) pins this.

**P-D7 — schema default `false`, gate opt-in.** The schema default and the
settings-service default are `false`, and `sec-06` normalises existing
rows. This is a deliberate reversal of Doc 2 section 5.5's implied
"default on", because a control that can lock out a counter on the day it
ships is not a control, it is an incident. Opt-in, with a documented
one-click flip, is the version that survives a pilot.

**First-device-is-trusted.** A user's first registered device is trusted at
read time, no SQL bootstrap. The rule is
`ORDER BY firstSeenAt ASC, id ASC LIMIT 1` inside the `device_ok` subquery.
It is evaluated at read time, not written to the table, and it
self-extinguishes as users register more devices. The `revokedAt IS NULL`
clause means a denied first device is not resurrected — denying the first
device deliberately leaves the user with no trusted device, which is what a
deny should do.

---

## 4. Verification

**Tests:**
- `tests/device-approval-gate.test.js` — 6 cases:
  1. no `PharmacySetting` row + untrusted device + enforce -> 200
  2. first-ever device, untrusted, setting on, enforce -> 200
  3. second untrusted device, setting on, enforce -> 403
     `DEVICE_APPROVAL_REQUIRED`
  4. no `X-Device-Id` header (released build) -> 200
  5. gate uses `req.client.deviceId`, not `body.deviceId` (P-D6)
  6. PIN change required takes precedence over device gate
- `tests/error-contract.test.js` — a new test enumerates `deny(...)` and
  `sendError(...)` code literals in `src/middleware/auth.js` and asserts
  each is registered in `CODES`. This is the guard that would have caught
  the `DEVICE_APPROVAL_REQUIRED` collapse before the gate test did; it
  grows its `files` list in the PR that adds an emission (P-13c adds the
  device route file).
- `tests/settings.test.js` — the "defaults when no row exists" assertion
  follows the flipped default (`true -> false`, commit `32f9341`). The
  `dbRow` mock factory stays gate-on; only the assertion changed.

**Full suite:** 329 passing / 45 suites passing (46 total, 1 pre-existing
orphan fail in `src/test.js`).

**Diff review:** `git diff` on all six files before commit. Each showed
only the intended hunks. `codes.js` was restored from HEAD and re-edited
with `-Encoding UTF8` after an encoding round trip corrupted its BOM and
non-ASCII comments — see section 6, lesson 3.

---

## 5. What P-13c does

**Routes** (Doc 2 section 4.3):
- `GET /auth/devices` — `self.devices`, T0. Lists the caller's devices.
- `DELETE /auth/devices/:id` — `self.devices`, T0. Revokes one of the
  caller's own devices.
- `GET /pharmacy/team/devices` — `team.devices.manage`, T0. Lists team
  devices for a manager.
- `POST /pharmacy/team/devices/:id/approve` — `team.devices.manage`, T2.
  Approves a pending device.
- `POST /pharmacy/team/devices/:id/deny` — `team.devices.manage`, T2.
  Denies a pending device and revokes the session.

**Service:** `src/domains/pharmacy/devices/devices.service.js` — a thin
domain service over the repository methods added in `bf9cdff`, matching the
`settings.service.js` precedent (`src/domains/pharmacy/settings/`). Routes
call the service; the service calls the repository. The deny path also
calls `revokeAllForUser` (already exported from
`pharmacy-session.service.js`).

**Audit events:** `device.approved`, `device.denied`, `device.revoked`
via the F2 shim. The deny event carries the affected user's id.

**Manager push:** sent directly through the existing `expo-server-sdk`
path in try/catch, recording `alert.delivery_failed` on failure. This is
the Doc 2 section 7.1 interim, since P-12's outbox does not exist yet.

**Route-policy entries:** every new route gets its registry entry in the
same commit (the PR definition of done from Doc 1). The route-policy gate
will fail if one is missing.

**Fixture ripple:** the enumeration test's `files` list gains the new
device route file, and any test that mounts the new routes gets the
route-policy entry in the same commit. This is the P-07 section 4 lesson,
which P-13b re-learned with `settings.test.js`.

---

## 6. Lessons

Four write/verification bugs surfaced in P-13b. Each was caught by reading
the file from disk before commit; each is a distinct failure mode; each
belongs here so P-13c starts with the right patterns.

**1. `Set-Content -NoNewline` with a `String[]` flattens the file to one
line.** `Get-Content` returns an array of lines; `-NoNewline` concatenates
the array with no separator. For a multi-line edit, use
`Set-Content -Value $lines` (default terminator). Reserve `-NoNewline` for
writes where the value is a single `[string]` (a here-string, a generated
blob). **And the region print must re-read from disk
(`Get-Content $path` after the write), not print the in-memory array used
to write** — otherwise it reports the edit you intended, not the file you
produced.

**2. Insertion index arithmetic duplicated a `/**` and orphaned a
docstring.** `$i -le 101` vs `$i -lt 101` — an inclusive/exclusive
off-by-one, and the total-line-count check (203) passed because the bug
was one remove + one add. **Compare the region print against the expected
output line by line, not just the total count.** The total being right
does not mean the file is right.

**3. `Get-Content`/`Set-Content` without `-Encoding UTF8` corrupts
non-ASCII on PowerShell 5.1.** `codes.js` had a BOM and `§`/`—` in
comments; two round trips turned the BOM into `//` and the symbols into
`<A7>`/`<97>`. **Use `-Encoding UTF8` on both read and write for any file
with non-ASCII**, and **`git diff` on every file before commit** — the diff
is the ground truth for encoding churn, not the region print (which goes
through the terminal's code page and may show `§` correctly while the file
is corrupted).

**4. The guard must count its matches, not `break` on the first.** The
`22a` edit that flipped the wrong `requireDeviceApproval` happened because
the pattern matched two lines (the `dbRow` factory and the test assertion)
and the guard took the first. **Enumerate all matches; if the count is not
what you expect, abort.** A single-anchor guard is only as good as the
anchor's uniqueness.

---

## 7. Handoff to P-13c

**Dependencies — all in place:**
- `UserDevice` with `platform`, `approvedById`, `approvedAt` (from
  `sec-01`/`sec-04`, already applied).
- The five repository methods from `bf9cdff` (`findDevice`,
  `listDevicesForUser`, `approveDevice`, `denyDevice`, `revokeDevice`).
- `revokeAllForUser` from `pharmacy-session.service.js` (the deny path).
- `DEVICE_APPROVAL_REQUIRED` and `DEVICE_DENIED` registered in `codes.js`.
- The `requireCapability` engine and the route-policy registry (P-01, P-02).

**One thing P-13c must inherit from P-13b's lessons:** update fixtures in
the same commit that adds a dependency. P-13b's `settings.test.js` flip
was missed because the step-4 grep did not include
`requireDeviceApproval`; the full-suite run caught it, but the read-first
grep would have caught it earlier. When P-13c adds the routes, the
enumeration test's `files` list and any route-mounting test fixtures move
in the same commit.
