# P-13c — device routes, service, audit — DONE

Commit: d91c894 (med-version)

## Delivered
- `src/routes/devices.js` — 5 routes: GET/DELETE `/auth/devices(/:id)`,
  GET `/pharmacy/team/devices`, POST `.../:id/approve`, POST `.../:id/deny`.
- `src/domains/pharmacy/devices/devices.service.js` — ownership + cross-pharmacy
  checks inside `prisma.$transaction`; approve/deny/revoke audit rows share the
  transaction (FAIL_CLOSED); deny calls `revokeAllForUser` after commit.
- `src/core/audit/catalogue.js` — `DEVICE_APPROVED/DENIED/REVOKED` in ACTIONS,
  REDACT, FAIL_CLOSED (already applied in the earlier catalogue edit).
- `pharmacy-session.repository.js` — `findDeviceById`, `approveDevice`,
  `denyDevice`, `revokeDevice` take `tx` (already applied).
- `src/core/authz/policy-registry.js` — `devices.js` registered in MOUNTS.
- `tests/devices-routes.test.js` — 6/6.

## Test state
336/336 tests pass. 46/47 suites; the 47th is the pre-existing empty
`src/test.js` (jest treats `**/test.js` as a test file; 0 tests, so it fails
"must contain at least one test"). Unrelated to P-13c — exclude via
`testPathIgnorePatterns` in a follow-up.

## Deviations from the P-13c plan, and why
- Service arg names are `deviceRowId`/`approverUserId`/`denierUserId`, not
  `id`/`approvedById`/`deniedById`. Routes and tests were aligned to the
  service rather than the reverse.
- `revokeOwnDevice` uses `repo.findDeviceById({ id, tx })` (one row) instead of
  `listDevicesForUser` + JS filter — the list version 404'd every request
  because of a name mismatch and did a full scan per revoke.
- `listTeamDevices` uses a raw join against `PharmacyUser`, not a Prisma
  `include`/relation filter — `UserDevice.actorId` has no Prisma relation to
  `PharmacyUser` by design.
- `loadAndCheck` uses `tx.$queryRaw` (raw join), not `findDeviceById` +
  `pharmacyUser.findUnique`; one query inside the transaction, same snapshot.

## Open
- `src/test.js` orphan suite (pre-existing, separate commit).
- P-13c-c (manager push on approve/deny) — not started, per the revised split.
