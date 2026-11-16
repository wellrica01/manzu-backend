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

describe('lockout severity (P-04 follow-on, Doc 2 section 5.4)', () => {
  test('below 5: severity is null', () => {
    expect(computeLockout(4).severity).toBeNull();
    expect(computeLockout(0).severity).toBeNull();
  });

  test('5-7 failures: severity lockout, no manager alert', () => {
    const r5 = computeLockout(5);
    expect(r5.severity).toBe('lockout');
    expect(r5.shouldAlert).toBe(false);
    const r7 = computeLockout(7);
    expect(r7.severity).toBe('lockout');
  });

  test('8-11 failures: severity notify (manager warning), no critical alert', () => {
    const r8 = computeLockout(8);
    expect(r8.severity).toBe('notify');
    expect(r8.shouldAlert).toBe(false);
    const r11 = computeLockout(11);
    expect(r11.severity).toBe('notify');
  });

  test('12+ failures: severity critical, shouldAlert true', () => {
    const r12 = computeLockout(12);
    expect(r12.severity).toBe('critical');
    expect(r12.shouldAlert).toBe(true);
    const r30 = computeLockout(30);
    expect(r30.severity).toBe('critical');
    expect(r30.shouldAlert).toBe(true);
  });

  test('SCHEDULE entries each carry a severity', () => {
    for (const s of SCHEDULE) {
      expect(['lockout', 'notify', 'critical']).toContain(s.severity);
    }
  });
});