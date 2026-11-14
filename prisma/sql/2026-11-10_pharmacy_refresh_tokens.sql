-- Task 4 (G2): rotating refresh tokens for pharmacy users (mobile app).
-- Idempotent: safe to run more than once, on BOTH databases
-- (local psql and Supabase SQL editor).
-- Only a SHA-256 hash of each token is stored, never the token itself.
-- "familyId" groups the tokens of one login chain: if an already-rotated token
-- is presented again (possible theft), the whole family is revoked.

CREATE TABLE IF NOT EXISTS "PharmacyRefreshToken" (
  "id"         SERIAL       PRIMARY KEY,
  "userId"     INTEGER      NOT NULL,
  "familyId"   VARCHAR(36)  NOT NULL,
  "tokenHash"  VARCHAR(64)  NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "revokedAt"  TIMESTAMP(3),
  "rotatedAt"  TIMESTAMP(3),
  "deviceInfo" VARCHAR(200),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PharmacyRefreshToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "PharmacyUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PharmacyRefreshToken_tokenHash_key" ON "PharmacyRefreshToken"("tokenHash");
CREATE INDEX        IF NOT EXISTS "PharmacyRefreshToken_userId_idx"    ON "PharmacyRefreshToken"("userId");
CREATE INDEX        IF NOT EXISTS "PharmacyRefreshToken_familyId_idx"  ON "PharmacyRefreshToken"("familyId");
