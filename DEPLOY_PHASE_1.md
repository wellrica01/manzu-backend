# Phase 1 Deploy Runbook — FND-01 to FND-12

**Branch:** `fnd-01-app-factory-and-context` (28 commits above `med-version`)
**Tests:** 213 passing from a baseline of 83. `src/test.js` fails to load as before (pre-existing orphan).
**Purpose of this document:** the exact steps to deploy the Phase 1 foundation to Render without a security regression and without a user-visible surprise. The order is deliberate; do not skip ahead.

---

## 0. What this deploy ships

Every new middleware in Phase 1 is **off or on a fallback by default**. The only user-visible change is the access-token TTL (15 minutes instead of 1 day), and the mobile app already refreshes on 401. Everything else is invisible until a later deploy flips an env var.

| Component | Default state | User-visible change |
|---|---|---|
| DB-validating guard (FND-05b3) | `SEC_ENFORCE=off` → signature-only, unchanged | None |
| New token claims (FND-05b2) | Signed with `JWT_SECRET` via `getSecretFor` fallback | TTL 1 day → 15 minutes |
| Split secrets (FND-05b1) | Missing → warns, falls back to `JWT_SECRET` | None |
| Capability engine (FND-04) | `SEC_ENFORCE=off` → no checks | None |
| Audit events (FND-03) | Writes to `AuditEvent` (new table) | None |
| Throttle + lockout (FND-07) | Postgres store, per-account lockout active | None (5 failures already locked you out per-IP) |
| Device registry (FND-09) | Upsert skipped when `X-Device-Id` absent | None (released builds don't send it) |
| Idempotency (FND-10) | `SEC_IDEMPOTENCY_MODE=off` → no-op | None (released builds don't send the header) |
| Step-up (FND-08) | `SEC_STEPUP_ENFORCE=off` → no-op; `POST /auth/step-up` exists but no route requires it | New endpoint, no caller |
| One Prisma client (FND-11) | Active — all services share one connection pool | None |
| Alert hook (FND-12) | Active — critical events reach Sentry | None (only fires on critical events) |
| Client contract headers (FND-10a) | Active — `X-Min-App-Version` on every response | New response header, ignored by released builds |

**Worst case if something is wrong:** the mobile app fails to log in or refresh. Rollback is section 6.

---

## 1. Pre-flight (30 minutes, before any deploy)

### 1.1 Verify the SQL is applied on both databases

The three SQL files were run and verified in FND-03 and FND-05. This section is a **re-verification**, not a first run. If any query below returns unexpected rows, stop and re-run the relevant `prisma/sql/*.sql` file (all three are idempotent).

**Local (`my_manzu_db`):**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('AuditEvent', 'AuthThrottle', 'IdempotencyKey', 'ApprovalRequest',
                     'UserDevice', 'AdminRefreshToken', 'AdminRoleGrant')
ORDER BY table_name;
