-- Manzu security hardening: pharmacy team lifecycle and settings (Doc 2 §5.8).
-- Idempotent: safe to run more than once, on BOTH databases (local psql and
-- Supabase SQL editor). Run AFTER sec-01-identity-session.sql.
--
-- Adds, on top of what sec-01 already ships:
--   PharmacyUser          lastActiveAt, invitedById, suspendedAt, suspendedById,
--                         removedAt, removedLabel, licenceNumber, licenceVerifiedAt
--                         and widens the status CHECK to add REMOVED
--   UserDevice            platform, approvedById, approvedAt
--   PharmacyUserInvite    new - invite codes (Doc 2 §5.2, P-06)
--   PharmacySetting       new - per-pharmacy limits (Doc 2 §3.4, P-06/P-08/P-09)
--
-- Types match the Prisma schema (TIMESTAMP(3), VARCHAR(n), NUMERIC(5,2),
-- BIGINT); Prisma client is regenerated from schema.prisma only, this file
-- is the database-side truth.
--
-- Wrapped in BEGIN/COMMIT because it drops and recreates a CHECK constraint
-- (PharmacyUser_status_check) and creates two tables; a partial run should
-- not leave either behind.

BEGIN;

-- ----- PharmacyUser: soft-delete and lifecycle columns -----

ALTER TABLE "PharmacyUser"
  ADD COLUMN IF NOT EXISTS "lastActiveAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invitedById"      INTEGER,
  ADD COLUMN IF NOT EXISTS "suspendedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedById"    INTEGER,
  ADD COLUMN IF NOT EXISTS "removedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "removedLabel"     VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "licenceNumber"    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "licenceVerifiedAt" TIMESTAMP(3);

-- Widen the sec-01 status CHECK to add REMOVED. The DO block makes the
-- drop/add a no-op if REMOVED is already accepted (second run).
DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'PharmacyUser_status_check'
    AND conrelid = '"PharmacyUser"'::regclass;

  IF current_def IS NULL OR current_def NOT LIKE '%REMOVED%' THEN
    ALTER TABLE "PharmacyUser" DROP CONSTRAINT IF EXISTS "PharmacyUser_status_check";
    ALTER TABLE "PharmacyUser" ADD CONSTRAINT "PharmacyUser_status_check"
      CHECK ("status" IN ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED', 'REMOVED'));
  END IF;
END $$;

-- Manager filter for team lists and the activity feed's "who is active" view.
CREATE INDEX IF NOT EXISTS "PharmacyUser_pharmacyId_status_idx"
  ON "PharmacyUser"("pharmacyId", "status");

-- ----- UserDevice: platform and approval trail -----

ALTER TABLE "UserDevice"
  ADD COLUMN IF NOT EXISTS "platform"     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "approvedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "approvedAt"   TIMESTAMP(3);

-- ----- PharmacyUserInvite (Doc 2 §5.2) -----

CREATE TABLE IF NOT EXISTS "PharmacyUserInvite" (
  "id"          SERIAL       PRIMARY KEY,
  "userId"      INTEGER      NOT NULL REFERENCES "PharmacyUser"("id") ON DELETE CASCADE,
  "codeHash"    VARCHAR(64)  NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "usedAt"      TIMESTAMP(3),
  "attempts"    SMALLINT     NOT NULL DEFAULT 0,
  "createdById" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PharmacyUserInvite_codeHash_key"
  ON "PharmacyUserInvite"("codeHash");
CREATE INDEX IF NOT EXISTS "PharmacyUserInvite_userId_idx"
  ON "PharmacyUserInvite"("userId");

-- ----- PharmacySetting (Doc 2 §3.4 / §5.8) -----

CREATE TABLE IF NOT EXISTS "PharmacySetting" (
  "pharmacyId"            INTEGER      PRIMARY KEY REFERENCES "Pharmacy"("id") ON DELETE CASCADE,
  "requireDeviceApproval" BOOLEAN      NOT NULL DEFAULT true,
  "staffOpeningHoursOnly" BOOLEAN      NOT NULL DEFAULT false,
  "lockAfterSeconds"      INTEGER      NOT NULL DEFAULT 60,
  "discountCapPct"        NUMERIC(5,2) NOT NULL DEFAULT 0,
  "voidWindowMinutes"     INTEGER      NOT NULL DEFAULT 10,
  "adjustThresholdUnits"  INTEGER      NOT NULL DEFAULT 20,
  "adjustApprovalUnits"   INTEGER      NOT NULL DEFAULT 100,
  "priceChangeCapPct"     INTEGER      NOT NULL DEFAULT 30,
  "refundLimitKobo"       BIGINT       NOT NULL DEFAULT 5000000,
  "bankHoldHours"         INTEGER      NOT NULL DEFAULT 48,
  "dailyDigest"           BOOLEAN      NOT NULL DEFAULT true,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById"           INTEGER
);

COMMIT;
