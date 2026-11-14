// src/middleware/request-id.js
// Assigns a request id, echoes it back, and seeds the actor context.
// Runs first in the pipeline (FND-01 S5.1 step 1).
//
// FND-10 extends this with the client-contract headers:
//   - reads X-App-Version and X-Device-Id from the request
//   - sets X-Min-App-Version on every response (from MIN_APP_VERSION)
//   - threads appVersion and deviceId into the actor context so that
//     audit.record and requireCapability can see the client, not just the
//     actor identity
//
// Enforcement of X-Min-App-Version is not in this commit. A future deploy
// will add a middleware that compares req.client.appVersion to the min and
// returns 426 UPGRADE_REQUIRED. The plumbing (the header, the context field)
// is here so the enforce middleware has something to read.

const { randomUUID } = require('node:crypto');
const { runWithContext } = require('../core/context/actor-context');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_VERSION = /^[0-9A-Za-z._-]{1,32}$/;

const MIN_APP_VERSION = process.env.MIN_APP_VERSION || '0.0.0';

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming)
    ? incoming
    : randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  res.setHeader('X-Min-App-Version', MIN_APP_VERSION);

  const rawVersion = req.headers['x-app-version'];
  const appVersion = typeof rawVersion === 'string' && SAFE_VERSION.test(rawVersion)
    ? rawVersion
    : null;

  const rawDeviceId = req.headers['x-device-id'];
  const deviceId = typeof rawDeviceId === 'string' && SAFE_ID.test(rawDeviceId)
    ? rawDeviceId
    : null;

  req.client = {
    appVersion,
    deviceId,
    minAppVersion: MIN_APP_VERSION,
  };

  // Seed the context now with the id and client meta. The session guard will
  // re-enter runWithContext with the actor; because runWithContext never
  // overwrites an existing store, the id and client set here survive into
  // the actor-aware context.
  runWithContext({ requestId: id, actor: null, client: req.client }, () => next());
}

module.exports = { requestId };