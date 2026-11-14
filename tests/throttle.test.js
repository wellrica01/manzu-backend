// tests/throttle.test.js
// Tests the memory store (the default). The Postgres store is exercised by
// the guard's smoke tests, not here (no DB in npm test).

process.env.THROTTLE_STORE = 'memory';
const memoryStore = require('../src/core/throttle/memory-store');

beforeEach(() => {
  memoryStore._resetAll();
});

describe('throttle memory store', () => {
  test('allows hits below the max', async () => {
    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      const r = await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i);
    }
  });

  test('denies the hit that exceeds the max', async () => {
    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    }
    const r = await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(60_000);
    expect(r.level).toBe(1);
  });

  test('denies while locked out, without incrementing', async () => {
    const now = Date.now();
    for (let i = 1; i <= 6; i++) {
      await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    }
    const r = await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now: now + 1000 });
    expect(r.allowed).toBe(false);
    expect(r.count).toBe(6); // no increment while locked
  });

  test('window expiry resets the counter', async () => {
    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    }
    const r = await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now: now + 60_001 });
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  test('lockout expiry lets the next hit through', async () => {
    const now = Date.now();
    for (let i = 1; i <= 6; i++) {
      await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    }
    const r = await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now: now + 60_001 });
    expect(r.allowed).toBe(true);
    expect(r.level).toBe(1); // level persists across lockout cycles
  });

  test('different keys are independent', async () => {
    const now = Date.now();
    for (let i = 1; i <= 6; i++) {
      await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    }
    const r = await memoryStore.hit({ class: 'login', key: 'b@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  test('reset clears the state', async () => {
    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    }
    await memoryStore.reset({ class: 'login', key: 'a@x.com' });
    const r = await memoryStore.hit({ class: 'login', key: 'a@x.com', windowMs: 60_000, max: 5, lockoutMs: 60_000, now });
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  test('the throttle interface picks memory when THROTTLE_STORE=memory', async () => {
    const t = require('../src/core/throttle');
    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      const r = await t.hit({ class: 'login', key: 'c@x.com', windowMs: 60_000, max: 5, lockoutMinutes: 1 });
      expect(r.allowed).toBe(true);
    }
    const r = await t.hit({ class: 'login', key: 'c@x.com', windowMs: 60_000, max: 5, lockoutMinutes: 1 });
    expect(r.allowed).toBe(false);
  });
});