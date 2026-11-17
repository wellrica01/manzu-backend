-- sec-06-pharmacy-device-approval.sql
-- Doc 2 section 5.5 (P-13b): the device-approval gate is opt-in per pharmacy.
--
-- Run AFTER sec-04 (which creates PharmacySetting). Idempotent; safe to
-- re-run. Owner runs this before the P-13b merge, under SEC_ENFORCE=enforce.
--
--   1. Column default for NEW rows becomes false. A gate that can lock out
--      a counter must never be on by surprise for a pharmacy that never
--      touched settings.
--   2. Existing rows that carry true are set to false, so the flip is
--      uniform. Expected to be zero or few rows (P-06 shipped PATCH recently);
--      the UPDATE is a no-op if none. A manager who wants the gate on flips
--      it after the merge, and PATCH writes SETTINGS_UPDATED to the audit log.
--
-- No device-trust UPDATE. "First registered device is trusted" is evaluated
-- at read time in loadPharmacyActor (P-13b), not written to the table; see
-- P-D7 in the status doc.

BEGIN;

ALTER TABLE "PharmacySetting"
  ALTER COLUMN "requireDeviceApproval" SET DEFAULT false;

UPDATE "PharmacySetting"
  SET "requireDeviceApproval" = false
  WHERE "requireDeviceApproval" = true;

COMMIT;