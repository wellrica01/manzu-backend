// src/core/errors/send-error.js
// The single error helper (Doc 1 §5.4).
// Body shape: { error, message, requestId, details?, statusCode?, code? }
//   - `error`     : stable code from codes.js
//   - `message`   : human-readable, safe to show
//   - `requestId` : echoed from req.requestId (set by request-id middleware)
//   - `details`   : optional; validation issues, Retry-After etc.
//   - `statusCode`: kept for one release so older clients keep working
//   - `code`      : kept for one release (legacy uppercase category)
// Nothing here throws. Safe to call from a catch block.

const { codeInfo, codeForStatus, isKnownCode } = require('./codes');

function requestIdOf(res) {
  return res.req && res.req.requestId ? res.req.requestId : undefined;
}

function sendError(res, status, code, message, details) {
  const safeStatus = Number.isInteger(status) ? status : 500;
  const resolvedCode = isKnownCode(code) ? code : codeForStatus(safeStatus);
  const info = codeInfo(resolvedCode);

  const body = {
    error: resolvedCode,
    message: message || info.message,
  };

  const rid = requestIdOf(res);
  if (rid) body.requestId = rid;
  if (details !== undefined) body.details = details;

  // Backwards compatibility — the mobile client reads `message`, the web
  // portals read `statusCode` and the legacy uppercase `code`. Keep both.
  body.statusCode = safeStatus;
  body.code = info.legacy ? resolvedCode : info.message && resolvedCode;

  return res.status(safeStatus).json(body);
}

module.exports = { sendError };
