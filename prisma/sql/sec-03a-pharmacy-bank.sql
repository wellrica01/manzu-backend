-- sec-03a-pharmacy-bank.sql
-- P-08 (Doc 2 section 6.1, 6.5 - bank part only).
-- Idempotent. Safe to re-run.
-- Run AFTER Doc 1 sec-01 and sec-02. Runs before any P-08 code depends on it.
-- Sales/inventory parts of sec-03 are split into sec-03b / sec-03c and land with P-09 / P-10.

BEGIN;

-- 1. Pharmacy: last4 + review flag. BankChange becomes the source of truth
-- for the pending destination; Pharmacy keeps the CURRENT active destination.
ALTER TABLE "Pharmacy"
  ADD COLUMN IF NOT EXISTS "bankAccountLast4"   VARCHAR(4),
  ADD COLUMN IF NOT EXISTS "bankReviewRequired" BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill last4 from the existing clear-text column. Safe on re-run.
UPDATE "Pharmacy"
   SET "bankAccountLast4" = RIGHT("bankAccountNumber", 4)
 WHERE "bankAccountNumber" IS NOT NULL
   AND "bankAccountLast4"  IS NULL;

-- 3. BankChange: pending destination, hold window, name-match, cancel/activate.
CREATE TABLE IF NOT EXISTS "BankChange" (
  "id"               SERIAL       PRIMARY KEY,
  "pharmacyId"       INTEGER      NOT NULL REFERENCES "Pharmacy"("id") ON DELETE CASCADE,
  "requestedById"    INTEGER      NOT NULL,
  "kind"             VARCHAR(10)  NOT NULL CHECK ("kind"    IN ('SETUP','UPDATE')),
  "status"           VARCHAR(12)  NOT NULL CHECK ("status"  IN ('PENDING','REVIEW','ACTIVE','CANCELLED','REJECTED')),
  "newBankName"      VARCHAR(100) NOT NULL,
  "newBankCode"      VARCHAR(10)  NOT NULL,
  "newAccountLast4"  VARCHAR(4)   NOT NULL,
  "newAccountName"   VARCHAR(255) NOT NULL,
  "newRecipientCode" VARCHAR(255) NOT NULL,
  "nameMatch"        VARCHAR(10)  NOT NULL CHECK ("nameMatch" IN ('MATCH','PARTIAL','MISMATCH')),
  "holdUntil"        TIMESTAMP(3) NOT NULL,
  "activatedAt"      TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  "cancelledById"    INTEGER,
  "clearedById"      INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- Only one open change per pharmacy at a time. A new request during a hold
-- must first cancel (or wait out) the current one.
CREATE UNIQUE INDEX IF NOT EXISTS "BankChange_one_open_per_pharmacy"
  ON "BankChange" ("pharmacyId")
  WHERE "status" IN ('PENDING','REVIEW');

-- The lazy-activation query scans this.
CREATE INDEX IF NOT EXISTS "BankChange_status_holdUntil_idx"
  ON "BankChange" ("status", "holdUntil");

COMMIT;