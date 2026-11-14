// src/core/errors/codes.js
// The stable error catalogue from Doc 1 §5.4. One list, one source of truth.
// Any caller that returns an error body should take its `error` field from here.

const CODES = {
  // Auth / session (new for FND-05, but the codes exist now so the handler and
  // sendError already speak them; FND-05 starts emitting them).
  UNAUTHENTICATED:      { status: 401, message: 'Authentication required.' },
  TOKEN_EXPIRED:        { status: 401, message: 'Your session expired. Please sign in again.' },
  SESSION_REVOKED:      { status: 401, message: 'Your session ended. Please sign in again.' },
  ACCOUNT_LOCKED:       { status: 403, message: 'Too many attempts. Please try again later.' },
  ACCOUNT_SUSPENDED:    { status: 403, message: 'This account is suspended.' },
  PHARMACY_SUSPENDED:   { status: 403, message: 'This pharmacy is not currently active.' },
  PIN_CHANGE_REQUIRED:  { status: 403, message: 'You must set a new PIN before continuing.' },

  // Capability / step-up (FND-04, FND-08)
  FORBIDDEN_CAPABILITY: { status: 403, message: 'You do not have permission to do this.' },
  STEP_UP_REQUIRED:     { status: 403, message: 'Please confirm your PIN to continue.' },
  STEP_UP_INVALID:      { status: 403, message: 'The confirmation is no longer valid.' },

  // Rate limiting (FND-07)
  RATE_LIMITED:         { status: 429, message: 'Too many requests. Please try again shortly.' },

  // Approvals (Doc 2/3)
  APPROVAL_REQUIRED:    { status: 409, message: 'This action needs approval from a manager.' },
  COOLING_OFF:          { status: 409, message: 'This action is on a cooling-off hold.' },

  // Offline plan reserved (Doc 1 §8.4)
  IDEMPOTENCY_MISMATCH: { status: 422, message: 'This request conflicts with an earlier one.' },
  STALE_STATE:          { status: 409, message: 'The data changed while you were offline. Please refresh.' },

  // Validation / not found / generic
  VALIDATION_ERROR:     { status: 400, message: 'Please check the details and try again.' },
  NOT_FOUND:            { status: 404, message: 'Not found.' },
  CONFLICT:             { status: 409, message: 'This conflicts with existing data.' },
  SERVER_ERROR:         { status: 500, message: 'Something went wrong. Please try again.' },

  // Legacy codes — kept for one release so every released mobile build keeps
  // matching them in normalizeErrorBody (manzu-mobile/src/api/errors.ts).
  NO_TOKEN:             { status: 401, message: 'No token provided.', legacy: true },
  INVALID_FORMAT:       { status: 401, message: 'Invalid authorization header.', legacy: true },
  INVALID_TOKEN:        { status: 401, message: 'Invalid token.', legacy: true },
  REFRESH_TOKEN_REUSED: { status: 401, message: 'Session ended. Please sign in again.', legacy: true },
};

// Map an AppError category (used by middleware/error-handler.js) to a code.
// Unknown categories fall through to SERVER_ERROR.
const CATEGORY_TO_CODE = {
  AUTH:          'UNAUTHENTICATED',
  VALIDATION:    'VALIDATION_ERROR',
  RATE_LIMIT:    'RATE_LIMITED',
  PAYMENT:       'SERVER_ERROR',
  STOCK:         'CONFLICT',
  DATABASE:      'SERVER_ERROR',
  EXTERNAL_API:  'SERVER_ERROR',
  SYSTEM:        'SERVER_ERROR',
  WEBHOOK:       'SERVER_ERROR',
};

function codeInfo(code) {
  return CODES[code] || CODES.SERVER_ERROR;
}

function isKnownCode(code) {
  return Object.prototype.hasOwnProperty.call(CODES, code);
}

function codeForStatus(status, fallback = 'SERVER_ERROR') {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN_CAPABILITY';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'IDEMPOTENCY_MISMATCH';
  if (status === 429) return 'RATE_LIMITED';
  return fallback;
}

module.exports = {
  CODES,
  CATEGORY_TO_CODE,
  codeInfo,
  isKnownCode,
  codeForStatus,
};
