-- Manzu security hardening: historical banking audit-log redaction
-- Run only after a verified database backup.
-- PostgreSQL / Prisma AuditLog.details (JSONB).

BEGIN;

UPDATE "AuditLog"
SET details =
    (details - 'accountNumber')
    || jsonb_build_object(
        'accountNumberLast4',
        RIGHT(details->>'accountNumber', 4)
    )
WHERE details ? 'accountNumber';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "AuditLog"
        WHERE details ? 'accountNumber'
    ) THEN
        RAISE EXCEPTION 'Bank account redaction incomplete';
    END IF;
END $$;

COMMIT;
