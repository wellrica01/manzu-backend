// src/middleware/request-id.js
// Assigns a request id, echoes it back, and seeds the actor context.
// Runs first in the pipeline (FND-01 §5.1 step 1).

const { randomUUID } = require('node:crypto');
const { runWithContext } = require('../core/context/actor-context');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming)
    ? incoming
    : randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  // Seed the context now with the id only; the session guard will call
  // runWithContext again with the actor when it validates the token.
  // Because runWithContext never overwrites an existing store, the
  // request id set here survives into the actor-aware context.
  runWithContext({ requestId: id, actor: null }, () => next());
}

module.exports = { requestId };
