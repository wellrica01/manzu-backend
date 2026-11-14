// src/core/auth/lockout.js
// Progressive lockout schedule for authentication. Pure: given the number of
// consecutive failures for an account, returns how long the account should
// remain locked.
//
// Doc 1 S5.3:
//   5 failures   -> 1 minute
//   8 failures   -> 15 minutes
//   12 failures  -> 1 hour + alert to the manager
//   A success    -> reset to 0
//
// The alert is emitted by the caller (lockout.compute returns { lockedUntil,
// shouldAlert, reason }); the caller decides how to notify.

const SCHEDULE = [
  { at: 5,  minutes: 1 },
  { at: 8,  minutes: 15 },
  { at: 12, minutes: 60, alert: true },
];

/**
 * Given a failure count, return { lockedUntil, shouldAlert, minutes }.
 * lockedUntil is null when the count is below the first threshold.
 */
function computeLockout(failureCount, now = new Date()) {
  const n = Number(failureCount) || 0;
  // Walk from the highest threshold down; the first one we meet wins.
  for (let i = SCHEDULE.length - 1; i >= 0; i--) {
    const step = SCHEDULE[i];
    if (n >= step.at) {
      return {
        lockedUntil: new Date(now.getTime() + step.minutes * 60 * 1000),
        shouldAlert: Boolean(step.alert),
        minutes: step.minutes,
      };
    }
  }
  return { lockedUntil: null, shouldAlert: false, minutes: 0 };
}

function isLocked(lockedUntil, now = new Date()) {
  return Boolean(lockedUntil) && new Date(lockedUntil) > now;
}

module.exports = { computeLockout, isLocked, SCHEDULE };