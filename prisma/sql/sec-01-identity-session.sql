-- Manzu security hardening: identity and session columns/tables (FND-05 + FND-09).
-- Idempotent: safe to run more than once, on BOTH databases (local psql and
-- Supabase SQL editor). Types match PharmacyRefreshToken and Prisma DateTime
-- (TIMESTAMP(3), CURRENT_TIMESTAMP), consistent with sec-02-audit-shared.sql.
--
-- Adds:
--   PharmacyUser          status, tokenVersion, failedAttempts, lockedUntil,
--                         lastLogin*, pinChangedAt, mustChangePin,
--                         pinHashVersion, phone, invitedAt, disabledAt
--   PharmacyRefreshToken  deviceId, lastUsedAt, lastIp
--   AdminUser             lastLoginAt, disabledAt, failedAttempts, lockedUntil,
--                         tokenVersion, emailVerifiedAt, mfaSecretEnc,
--                         mfaEnrolledAt
--   UserDevice            new - device registry (FND-09, Doc 2's "your devices")
--   AdminRefreshToken     new - Doc 3 admin sessions
--   AdminRoleGrant        new - Doc 3 grants table
--
-- Wrapped in BEGIN/COMMIT. Each ALTER uses ADD COLUMN IF NOT EXISTS; the
-- CHECK on PharmacyUser.status uses a DO block so a second run is a no-op.

BEGIN;

-- ----- PharmacyUser -----

ALTER TABLE "PharmacyUser"
  ADD COLUMN IF NOT EXISTS "status"         VARCHAR(12)  NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "tokenVersion"   INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failedAttempts" INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastLoginAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastLoginIp"    VARCHAR(45),
  ADD COLUMN IF NOT EXISTS "pinChangedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mustChangePin"  BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pinHashVersion" SMALLINT     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "phone"          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "invitedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disabledAt"     TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PharmacyUser_status_check'
  ) THEN
    ALTER TABLE "PharmacyUser" ADD CONSTRAINT "PharmacyUser_status_check"
      CHECK ("status" IN ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED'));
  END IF;
END $$;

-- ----- PharmacyRefreshToken -----

ALTER TABLE "PharmacyRefreshToken"
  ADD COLUMN IF NOT EXISTS "deviceId"   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastIp"     VARCHAR(45);

-- ----- AdminUser -----

ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "lastLoginAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disabledAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedAttempts"  INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tokenVersion"    INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mfaSecretEnc"    TEXT,
  ADD COLUMN IF NOT EXISTS "mfaEnrolledAt"   TIMESTAMP(3);

-- ----- UserDevice (FND-09) -----

CREATE TABLE IF NOT EXISTS "UserDevice" (
  "id"          BIGSERIAL     PRIMARY KEY,
  "actorType"   VARCHAR(16)   NOT NULL,
  "actorId"     INTEGER       NOT NULL,
  "deviceId"    VARCHAR(64)   NOT NULL,
  "label"       VARCHAR(120),
  "publicKey"   TEXT,
  "trusted"     BOOLEAN       NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastIp"      VARCHAR(45),
  "revokedAt"   TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserDevice_actor_device_key"
  ON "UserDevice"("actorType", "actorId", "deviceId");

-- ----- AdminRefreshToken (Doc 3) -----

CREATE TABLE IF NOT EXISTS "AdminRefreshToken" (
  "id"         SERIAL        PRIMARY KEY,
  "adminId"    INTEGER       NOT NULL,
  "familyId"   VARCHAR(36)   NOT NULL,
  "tokenHash"  VARCHAR(64)   NOT NULL,
  "expiresAt"  TIMESTAMP(3)  NOT NULL,
  "revokedAt"  TIMESTAMP(3),
  "rotatedAt"  TIMESTAMP(3),
  "deviceId"   VARCHAR(64),
  "deviceInfo" VARCHAR(200),
  "lastIp"     VARCHAR(45),
  "createdAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminRefreshToken_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminRefreshToken_tokenHash_key" ON "AdminRefreshToken"("tokenHash");
CREATE INDEX        IF NOT EXISTS "AdminRefreshToken_admin_idx"     ON "AdminRefreshToken"("adminId");
CREATE INDEX        IF NOT EXISTS "AdminRefreshToken_family_idx"    ON "AdminRefreshToken"("familyId");

-- ----- AdminRoleGrant (Doc 3) -----

CREATE TABLE IF NOT EXISTS "AdminRoleGrant" (
  "id"         SERIAL       PRIMARY KEY,
  "adminId"    INTEGER      NOT NULL,
  "role"       VARCHAR(24)  NOT NULL,
  "grantedBy"  INTEGER,
  "grantedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"  TIMESTAMP(3),
  CONSTRAINT "AdminRoleGrant_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminRoleGrant_active_key"
  ON "AdminRoleGrant"("adminId", "role") WHERE "revokedAt" IS NULL;

COMMIT;