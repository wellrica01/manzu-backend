// src/core/context/actor-context.js
// AsyncLocalStorage-backed request context.
// Nothing populates the actor yet; FND-05 (session guard) will.
// Read-only consumers (audit, authz, logging) call currentActor() and
// currentRequestId() so services never need `req` passed in.

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with the given context (requestId + optional actor).
 * Never overwrite an existing context — a request may nest service calls
 * that re-enter runWithContext; the outermost wins.
 */
function runWithContext(ctx, fn) {
  const existing = storage.getStore();
  if (existing) {
    return fn();
  }
  return storage.run(Object.freeze({ ...ctx }), fn);
}

/**
 * Who is acting, or null when outside a request / job.
 * Shape (see Doc 1 §3.1):
 *   { type, id, pharmacyId, role, sessionId, deviceId, ip, userAgent,
 *     requestId, label }
 */
function currentActor() {
  const store = storage.getStore();
  return store && store.actor ? store.actor : null;
}

function currentRequestId() {
  const store = storage.getStore();
  return store ? store.requestId : undefined;
}

/**
 * Wrap a background job so its audit rows carry actorType 'system'.
 * The jobName is used as the label and appears in every audit event
 * emitted from inside `fn`.
 */
function runAsSystem(jobName, fn) {
  if (!jobName || typeof jobName !== 'string') {
    throw new TypeError('runAsSystem(jobName, fn): jobName must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('runAsSystem(jobName, fn): fn must be a function');
  }
  const ctx = {
    requestId: `job:${jobName}:${Date.now()}`,
    actor: Object.freeze({
      type: 'system',
      id: null,
      label: jobName,
      role: 'system',
    }),
  };
  return runWithContext(ctx, fn);
}

module.exports = {
  runWithContext,
  currentActor,
  currentRequestId,
  runAsSystem,
  // exposed for tests only
  _storage: storage,
};
