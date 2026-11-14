// tests/lockout.test.js
const { computeLockout, isLocked, SCHEDULE } = require('../src/core/auth/lockout');

describe('lockout schedule', () => {
  test('below the first threshold: no lockout', () => {
    for (let n = 0; n < 5; n++) {
      const r = computeLockout(n);
      expect(r.lockedUntil).toBeNull();
      expect(r.shouldAlert).toBe(false);
    }
  });

  test('5 failures -> 1 minute', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const r = computeLockout(5, now);
    expect(r.minutes).toBe(1);
    expect(r.shouldAlert).toBe(false);
    expect(r.lockedUntil.getTime() - now.getTime()).toBe(60_000);
  });

  test('8 failures -> 15 minutes', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const r = computeLockout(8, now);
    expect(r.minutes).toBe(15);
    expect(r.lockedUntil.getTime() - now.getTime()).toBe(15 * 60_000);
  });

  test('12 failures -> 1 hour and alert', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const r = computeLockout(12, now);
    expect(r.minutes).toBe(60);
    expect(r.shouldAlert).toBe(true);
    expect(r.lockedUntil.getTime() - now.getTime()).toBe(60 * 60_000);
  });

  test('30 failures -> still 1 hour (highest tier wins)', () => {
    const r = computeLockout(30);
    expect(r.minutes).toBe(60);
    expect(r.shouldAlert).toBe(true);
  });

  test('isLocked', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    expect(isLocked(future)).toBe(true);
    expect(isLocked(past)).toBe(false);
    expect(isLocked(null)).toBe(false);
  });

  test('SCHEDULE is the documented list', () => {
    expect(SCHEDULE.map((s) => s.at)).toEqual([5, 8, 12]);
  });
});