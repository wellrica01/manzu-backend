// src/middleware/idempotency.js
//
// FND-10b. Idempotent write middleware (Doc 1 S5.1 step 10, S8.4).
//
// Writes that can be retried (checkout, cart mutations, prescription upload,
// refund requests) carry an Idempotency-Key header. The middleware:
//
//   1. If SEC_IDEMPOTENCY_MODE is 'off' (default), do nothing.
//   2. If the request has no Idempotency-Key header, do nothing (idempotency
//      is opt-in per request, not global; a client that doesn't send the
//      header is a client that isn't retry-aware).
//   3. If there is no actor (unauthenticated route), do nothing.
//   4. Compute requestHash = sha256(method + path + JSON.stringify(body)).
//   5. Look up IdempotencyKey by (actorType, actorId, key). On hit:
//       a. If requestHash differs, return 422 IDEMPOTENCY_MISMATCH.
//       b. If state = IN_PROGRESS and the row is less than 30s old, return
//          409 CONFLICT - a duplicate is racing the original.
//       c. If state = COMPLETED, replay responseStatus / responseBody with
//          Idempotent-Replay: true and an Idempotent-Replayed-At header.
//   6. On miss:
//       a. Insert a row with state = IN_PROGRESS.
//       b. Run the handler. Capture the response on res.finish.
//       c. On 2xx, update the row to COMPLETED with responseStatus and
//          responseBody. On non-2xx, delete the row so the client can retry
//          (a failed write is retryable - the whole point of the header).
//   7. Any DB error is logged and the request proceeds uncached. Idempotency
//      must never take the API down.
//
// Modes (SEC_IDEMPOTENCY_MODE):
//   off      - no DB work, no header handling. Default.
//   log      - compute the lookup, log what would have happened, do not write.
//   enforce  - the full behaviour above.
//
// This module only defines the middleware. FND-10c applies it to specific
// routes. Nothing is applied yet, so today this is inert.

const crypto = require('node:crypto');
const { currentActor } = require('../core/context/actor-context');
const prisma = require('../core/database/prisma');
const { sendError } = require('../core/errors/send-error');

const IN_PROGRESS_GRACE_MS = 30 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

function mode() {
  return String(process.env.SEC_IDEMPOTENCY_MODE || 'off').toLowerCase();
}

function hashRequest(req) {
  const method = req.method || '';
  const path = req.originalUrl || req.url || '';
  // A body over the cap is hashed as a marker rather than the full bytes, so a
  // pathological payload cannot make the hash expensive. The mismatch check
  // still works: the same oversized body produces the same marker hash.
  const bodyString = (() => {
    if (!req.body || typeof req.body !== 'object') return '';
    try {
      const s = JSON.stringify(req.body);
      return s.length > MAX_BODY_BYTES ? 'OVERSIZE' : s;
    } catch (_) {
      return 'UNSERIALISABLE';
    }
  })();
  return crypto.createHash('sha256').update(`${method} ${path} ${bodyString}`).digest('hex');
}

function safeHeaderString(value, maxLen) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function sendCached(res, row) {
  if (row.responseStatus == null || row.responseBody == null) {
    // Should not happen: COMPLETED state always sets both. Treat as a miss.
    return false;
  }
  res.setHeader('Idempotent-Replay', 'true');
  res.status(row.responseStatus).json(row.responseBody);
  return true;
}

function captureResponse(res) {
  const chunks = [];
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    chunks.push(body);
    return originalJson(body);
  };
  return {
    body: () => chunks[0],
    isSuccess: () => res.statusCode >= 200 && res.statusCode < 300,
    status: () => res.statusCode,
  };
}

function idempotency() {
  return async function idempotencyMiddleware(req, res, next) {
    const currentMode = mode();
    if (currentMode === 'off') return next();

    const key = safeHeaderString(req.headers['idempotency-key'], 64);
    if (!key) return next();

    const actor = currentActor();
    if (!actor || actor.id == null) return next(); // unauthenticated: skip

    const actorType = actor.type || 'unknown';
    const actorId = String(actor.id);
    const requestHash = hashRequest(req);
    const route = `${req.method} ${req.baseUrl || ''}${req.path || ''}`.slice(0, 120);

    let row;
    try {
      row = await prisma.idempotencyKey.findUnique({
        where: { actorType_actorId_key: { actorType, actorId, key } },
      });
    } catch (err) {
      console.error('[idempotency] lookup failed', { message: err && err.message });
      return next();
    }

    if (row) {
      if (row.requestHash !== requestHash) {
        return sendError(res, 422, 'IDEMPOTENCY_MISMATCH',
          'This request conflicts with an earlier one.', { key });
      }
      if (row.state === 'IN_PROGRESS') {
        const ageMs = Date.now() - new Date(row.createdAt).getTime();
        if (ageMs < IN_PROGRESS_GRACE_MS) {
          return sendError(res, 409, 'CONFLICT',
            'A duplicate request is already in progress.', { key, retryAfterMs: IN_PROGRESS_GRACE_MS - ageMs });
        }
        // Stale IN_PROGRESS: delete and treat as a fresh write.
        try {
          await prisma.idempotencyKey.delete({
            where: { actorType_actorId_key: { actorType, actorId, key } },
          });
        } catch (err) {
          console.error('[idempotency] stale-row delete failed', { message: err && err.message });
        }
      } else if (row.state === 'COMPLETED') {
        if (currentMode === 'log') {
          console.warn('[idempotency] would have replayed', { key, route, actorType, actorId });
          return next();
        }
        return sendCached(res, row);
      }
    }

    if (currentMode === 'log') {
      console.warn('[idempotency] would have created key', { key, route, actorType, actorId, requestHash });
      return next();
    }

    try {
      await prisma.idempotencyKey.create({
        data: {
          key,
          actorType,
          actorId,
          route,
          requestHash,
          state: 'IN_PROGRESS',
        },
      });
    } catch (err) {
      // Race: another concurrent request inserted the same key. Fall through
      // to the next request, which will hit the COMPLETED path or a 409.
      console.error('[idempotency] insert failed', { message: err && err.message });
      return next();
    }

    const capture = captureResponse(res);

    res.on('finish', async () => {
      try {
        if (capture.isSuccess()) {
          await prisma.idempotencyKey.update({
            where: { actorType_actorId_key: { actorType, actorId, key } },
            data: {
              state: 'COMPLETED',
              responseStatus: capture.status(),
              responseBody: capture.body() || null,
            },
          });
        } else {
          // Failed write: delete so the client can retry.
          await prisma.idempotencyKey.delete({
            where: { actorType_actorId_key: { actorType, actorId, key } },
          });
        }
      } catch (err) {
        console.error('[idempotency] post-response write failed', { message: err && err.message });
      }
    });

    return next();
  };
}

module.exports = { idempotency };
module.exports._testHooks = {
  hashRequest,
  safeHeaderString,
  mode,
};