-- Manzu security hardening: audit + shared cross-cutting tables (FND-03 + FND-07 + FND-10 + Doc 2/3).
-- Idempotent: safe to run more than once, on BOTH databases (local psql and Supabase SQL editor).
--
-- Creates:
--   AuditEvent       append-only audit and security events (FND-03)
--   AuthThrottle     rate-limit counters that survive a restart (FND-07)
--   IdempotencyKey   replay-safe writes (FND-10, Doc 1 S5.1 step 10)
--   ApprovalRequest  maker-checker rows (Doc 2/3 build on it, Doc 1 S6.4 schema)
--
-- Deviations from Doc 1 S6.4, both deliberate:
--   1. TIMESTAMP(3) and CURRENT_TIMESTAMP instead of timestamptz / now(), to match the
--      existing PharmacyRefreshToken table and Prisma's DateTime mapping.
--   2. Wrapped in BEGIN/COMMIT, matching sec-00-containment.sql, because this file
--      creates a function and two triggers; a partial run should not leave either
--      behind.
--
-- The "AuditEvent_no_change" and "AuditEvent_no_truncate" triggers make the table
-- append-only even for the database owner. Retention is out of scope until decided
-- with counsel; when it lands, it must be done by dropping whole partitions, not
-- by DELETE -- the trigger is intentional.

BEGIN;

CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id"          BIGSERIAL      PRIMARY KEY,
  "occurredAt"  TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientAt"    TIMESTAMP(3),
  "kind"        VARCHAR(10)    NOT NULL DEFAULT 'audit',
  "action"      VARCHAR(80)    NOT NULL,
  "outcome"     VARCHAR(10)    NOT NULL DEFAULT 'success',
  "severity"    VARCHAR(10)    NOT NULL DEFAULT 'info',
  "actorType"   VARCHAR(16)    NOT NULL,
  "actorId"     VARCHAR(64),
  "actorRole"   VARCHAR(24),
  "actorLabel"  VARCHAR(120),
  "pharmacyId"  INTEGER,
  "entityType"  VARCHAR(40),
  "entityId"    VARCHAR(64),
  "before"      JSONB,
  "after"       JSONB,
  "sessionId"   VARCHAR(36),
  "deviceId"    VARCHAR(64),
  "ip"          VARCHAR(45),
  "userAgent"   VARCHAR(300),
  "requestId"   VARCHAR(40),
  "visibility"  VARCHAR(10)    NOT NULL DEFAULT 'both'
);

CREATE INDEX IF NOT EXISTS "AuditEvent_pharm_idx"  ON "AuditEvent"("pharmacyId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditEvent_actor_idx"  ON "AuditEvent"("actorType", "actorId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditEvent_entity_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditEvent_sec_idx"    ON "AuditEvent"("kind", "severity", "occurredAt" DESC);

CREATE OR REPLACE FUNCTION audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AuditEvent_no_change" ON "AuditEvent";
CREATE TRIGGER "AuditEvent_no_change"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

DROP TRIGGER IF EXISTS "AuditEvent_no_truncate" ON "AuditEvent";
CREATE TRIGGER "AuditEvent_no_truncate"
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();

CREATE TABLE IF NOT EXISTS "AuthThrottle" (
  "key"          VARCHAR(160)  PRIMARY KEY,
  "count"        INTEGER       NOT NULL DEFAULT 0,
  "windowStart"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil"  TIMESTAMP(3),
  "level"        SMALLINT      NOT NULL DEFAULT 0,
  "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AuthThrottle_updated_idx" ON "AuthThrottle"("updatedAt");

CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
  "key"            VARCHAR(64)   NOT NULL,
  "actorType"      VARCHAR(16)   NOT NULL,
  "actorId"        VARCHAR(64)   NOT NULL,
  "route"          VARCHAR(120)  NOT NULL,
  "requestHash"    VARCHAR(64)   NOT NULL,
  "state"          VARCHAR(12)   NOT NULL DEFAULT 'IN_PROGRESS',
  "responseStatus" SMALLINT,
  "responseBody"   JSONB,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP + interval '24 hours',
  PRIMARY KEY ("actorType", "actorId", "key")
);
CREATE INDEX IF NOT EXISTS "IdempotencyKey_expires_idx" ON "IdempotencyKey"("expiresAt");

CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
  "id"           BIGSERIAL     PRIMARY KEY,
  "scope"        VARCHAR(10)   NOT NULL DEFAULT 'platform',
  "pharmacyId"   INTEGER,
  "action"       VARCHAR(80)   NOT NULL,
  "payload"      JSONB         NOT NULL,
  "payloadHash"  VARCHAR(64)   NOT NULL,
  "makerType"    VARCHAR(16)   NOT NULL,
  "makerId"      VARCHAR(64)   NOT NULL,
  "status"       VARCHAR(10)   NOT NULL DEFAULT 'PENDING',
  "checkerType"  VARCHAR(16),
  "checkerId"    VARCHAR(64),
  "decidedAt"    TIMESTAMP(3),
  "expiresAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP + interval '24 hours',
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalRequest_checker_not_maker"
    CHECK ("checkerId" IS NULL OR ("checkerType", "checkerId") <> ("makerType", "makerId"))
);

COMMIT;
