# P-13c — device routes, service, audit — DONE (P-13c-c outstanding)

**Branch:** `med-version` (pushed to `origin/med-version`, deploys to Render).
**Commits:** `d02cd1e` (7 files: routes, service, tests, MOUNTS, app mount, catalogue, repo tx) and `0ba88b4` (this status doc). **Not** `d91c894` — that hash was the first attempt, superseded when the wiring was folded back in; it is no longer on the branch. The `p13c-safety-265fe35` safety branch held the pre-cleanup shape and is deleted.
**Tests:** 11/11 in `devices-routes.test.js` (6) + `route-policy.test.js` (5); full suite **336/336 tests, 46/47 suites** — the 47th is the pre-existing empty `src/test.js` orphan, unrelated to P-13c and scheduled for a separate `testPathIgnorePatterns` commit.

---

## Status

**P-13c shipped to `med-version` (Render).** Commit `d02cd1e` (7 files), `0ba88b4` (docs). 11/11 tests in the device and route-policy suites; 336/336 full suite, 46/47 suites (the 47th is the pre-existing empty `src/test.js`).

**P-13c-c outstanding** — manager push on approve/deny, `alert.delivery_failed` on failure. Nothing about the shipped commit depends on it; it is additive.

**Gate stays dark** — `requireDeviceApproval = false` everywhere. Do not flip until P-13c-c ships and a build with the devices screen reaches managers. Turning the gate on without the notification is the scenario the P-13b status (§2) warns against.

---
## What shipped

**Routes** (`src/routes/devices.js`, mounted at `app.use('/api', deviceRoute)` in `src/app.js`):
- `GET /api/auth/devices` — `self.devices`, T0. Lists the caller's devices.
- `DELETE /api/auth/devices/:id` — `self.devices`, T0. Revokes one of the caller's own devices.
- `GET /api/pharmacy/team/devices` — `team.devices.manage`, T0. Lists team devices for a manager.
- `POST /api/pharmacy/team/devices/:id/approve` — `team.devices.manage`, T2.
- `POST /api/pharmacy/team/devices/:id/deny` — `team.devices.manage`, T2; also calls `revokeAllForUser` after the transaction commits, so a deny is effective even when the approval gate is off.

The mount prefix is `/api`, **not** `/api/devices` — the router's own paths already begin with `/auth` and `/pharmacy/team`. A wrong mount prefix is invisible to `devices-routes.test.js` (which mounts the router directly), so a real smoke test against `createApp()` is a P-13c-c test gap.

**Service** (`src/domains/pharmacy/devices/devices.service.js`): ownership and cross-pharmacy checks run **inside** `prisma.$transaction`; approve/deny/revoke and their audit rows share one transaction (FAIL_CLOSED). `approveDevice`/`denyDevice` accept `{ pharmacyId, approverUserId|denierUserId, deviceRowId }`; `revokeOwnDevice` accepts `{ userId, deviceRowId }`. `loadAndCheck` uses a raw `tx.$queryRaw` join against `PharmacyUser` — `UserDevice.actorId` has no Prisma relation to `PharmacyUser` by design, so a relation-based `include` would throw at runtime. `listTeamDevices` uses the same raw join.

**Audit** (`src/core/audit/catalogue.js`): `DEVICE_APPROVED`/`DEVICE_DENIED`/`DEVICE_REVOKED` in `ACTIONS`, matching `REDACT` allow-lists, and the **object keys** in `FAIL_CLOSED` (matching the existing `'SETTINGS_UPDATED'` convention, not the `'device.approved'` value).

**Repository** (`src/domains/auth/pharmacy/pharmacy-session.repository.js`): `findDevice`, `findDeviceById`, `approveDevice`, `denyDevice`, `revokeDevice` accept an optional `tx` and use `(tx || prisma)` — the `settings.repository.js` pattern.

**Policy registry** (`src/core/authz/policy-registry.js`): `{ prefix: '/api', file: 'devices.js' }` in `MOUNTS`. `route-policy.test.js` goes green only with this entry; without it, CI fails on the missing declaration.

---
## Deviations from the original plan, and why

- Service arg names are `deviceRowId` / `approverUserId` / `denierUserId`, not `id` / `approvedById` / `deniedById`. The routes were aligned to the service, not the service to the routes. The first attempt (`d91c894`) had the two mismatched, which 404'd every self-revoke and 500'd every manager action.
- `revokeOwnDevice` uses `repo.findDeviceById({ id, tx })` (one row) instead of `listDevicesForUser` + JS filter. The list version did a full scan per revoke and, combined with the arg-name mismatch, `notFound()`'d every request.
- `listTeamDevices` uses a raw join against `PharmacyUser`, not a Prisma relation filter — the relation does not exist in the schema.
- `loadAndCheck` uses `tx.$queryRaw` (one query inside the transaction, same snapshot) rather than `findDeviceById` + `pharmacyUser.findUnique` (two round-trips, and the tests would need to mock `pharmacyUser.findUnique` rather than the query).

---

## Lessons from this round (add to P-13b's four)

1. **A green test does not mean a complete commit.** `d91c894` passed all six device tests but was missing `app.js` (mount), `catalogue.js` (ACTIONS entries), and `pharmacy-session.repository.js` (`tx` support) — three of the seven files the plan listed as already applied. They were in the working tree, not the commit. A fresh clone of `d91c894` would have failed the tests. Lesson: `git show --stat <commit>` against the plan's file list, **before** calling it done, not after.
2. **A wrong mount prefix is invisible to a router-direct test.** `app.use('/api/devices', deviceRoute)` doubles the prefix (`/api/devices/auth/devices`). `devices-routes.test.js` bypasses `app.js` (`a.use(router)`), so it passes either way. Lesson: one smoke test against `createApp()` that hits `POST /api/pharmacy/team/devices/1/approve` and expects a non-404 (or a capability denial, not a route miss). Add this in P-13c-c.
3. **`Set-Content -Encoding UTF8` on PowerShell 5.1 writes a BOM.** `pharmacy-session.repository.js` gained a `\xEF\xBB\xBF` at byte 0, which Node tolerates but git flags as a line-1 change. Lesson: `[System.IO.File]::WriteAllText($p, $text, [System.Text.UTF8Encoding]::new($false))` for BOM-less writes; `-Encoding ascii` for pure-ASCII; never `-Encoding UTF8` on 5.1.
4. **`git commit --amend` rewrites `HEAD`, not the commit you name.** The first amend targeted the status-doc commit on top of `d91c894`, folding the wiring into a `docs` commit — a future `git revert` of that "docs" commit would have unmounted the routes. Fixed with `git reset --soft d91c894~1`, re-staging, and committing in the intended shape. Lesson: `--amend` is `HEAD`-only; if the mislabeled content is not `HEAD`, `reset --soft` and re-partition.
5. **`git status`'s ahead-count is cached.** After `reset --soft`, `[ahead 3]` was reported against a reality of five. A fresh `git log origin/med-version..HEAD` corrected it. Lesson: the range command, not the ahead-count, is authoritative before a push.

---
## Open

- **P-13c-c** â€” manager push on approve/deny, `alert.delivery_failed` on failure. Direct `expo-server-sdk` in try/catch, sent **after** the transaction commits. Two tests: "approve sends a push" and "push failure doesn't roll back the approval." Once this ships, and once a mobile build with the devices screen reaches managers, `requireDeviceApproval` can be flipped per pharmacy with `PATCH /pharmacy/settings`. Not before.
- **A `createApp()` smoke test** for the device routes (see lesson 2) â€” P-13c-c.
- **`src/test.js` orphan suite** â€” pre-existing, separate commit. Add `testPathIgnorePatterns: ['<rootDir>/src/test.js']` to the jest config in `package.json` or `jest.config.js`, and the full suite becomes 46/46 suites green with 336 tests.
- **P-13's `Done when` (Doc 2 Â§9.1)** â€” "New device from STAFF blocked until approved; deny revokes at once" â€” proven by `device-approval-gate.test.js` case 3 and the deny test in `devices-routes.test.js`. The Â§7.1 "alerts reach the manager within minutes" requirement is the P-13c-c gap.

---

## Final shape of the two commits on `origin/med-version`

    0ba88b4  docs(P-13c): status                                                                  1 file
    d02cd1e  fix(P-13c): device routes, service, tests, MOUNTS, app mount, catalogue, repo tx   7 files, +365 / -11

`d02cd1e`'s seven files: `src/app.js`, `src/core/authz/policy-registry.js`, `src/core/audit/catalogue.js`, `src/domains/auth/pharmacy/pharmacy-session.repository.js`, `src/domains/pharmacy/devices/devices.service.js`, `src/routes/devices.js`, `tests/devices-routes.test.js`.