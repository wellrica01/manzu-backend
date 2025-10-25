# 🔄 Database Migration Instructions for Fix #4

## Create and Apply Migration

Run these commands to create the ProcessedWebhook table:

```bash
# Generate migration
npx prisma migrate dev --name add_processed_webhook_table

# This will:
# 1. Create migration SQL file
# 2. Apply migration to database
# 3. Regenerate Prisma Client
```

## What This Creates

The migration adds a new table:

```sql
CREATE TABLE "ProcessedWebhook" (
  "id" SERIAL PRIMARY KEY,
  "eventId" TEXT UNIQUE NOT NULL,
  "eventType" TEXT NOT NULL,
  "processedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "payload" JSONB
);

CREATE INDEX "ProcessedWebhook_eventId_idx" ON "ProcessedWebhook"("eventId");
CREATE INDEX "ProcessedWebhook_processedAt_idx" ON "ProcessedWebhook"("processedAt");
```

## Verify Migration

```bash
# Check migration status
npx prisma migrate status

# View database tables
npx prisma studio
```

## If Migration Fails

If you get errors, try:

```bash
# Reset database (WARNING: Deletes all data!)
npx prisma migrate reset

# Or apply manually
npx prisma db push
```

## Production Deployment

For production, run:

```bash
# Deploy migrations (doesn't reset data)
npx prisma migrate deploy
```
