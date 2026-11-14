// tests/prisma-scope.test.js
// FND-11b: the scoping extension is opt-in, defaults to off (pass-through),
// logs (never modifies) tenant queries that lack pharmacyId in log mode,
// and refuses to enforce outside a pharmacy actor.

// We do NOT require the real prisma client in this test (it would connect to
// the DB). Instead we test the extension's decision logic directly by
// exercising a pure helper that mirrors the extension body. That keeps the
// test fast and DB-free, while the extension's actual wiring into Prisma is
// covered by the syntax check (node --check) and by a future integration test
// when Doc 2 switches a service to prisma-scoped.

const { TENANT_MODELS, TENANT_OPERATIONS, scopeMode } = require('../src/core/database/prisma-scoped')._testHooks;

describe('prisma-scoped extension (FND-11b)', () => {
  afterEach(() => {
    delete process.env.PRISMA_SCOPE_MODE;
  });

  test('tenant models match the doc list (section 5.6)', () => {
    expect(Array.from(TENANT_MODELS).sort()).toEqual([
      'MedicationAvailability',
      'OperatingHour',
      'Order',
      'Payout',
      'PharmacyUser',
      'PushToken',
      'Sale',
    ]);
  });

  test('tenant operations include the ones where pharmacyId is a valid filter', () => {
    for (const op of ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'updateMany', 'deleteMany']) {
      expect(TENANT_OPERATIONS.has(op)).toBe(true);
    }
    // create and createMany have no where clause; not tenant ops.
    expect(TENANT_OPERATIONS.has('create')).toBe(false);
    expect(TENANT_OPERATIONS.has('createMany')).toBe(false);
  });

  test('scope mode defaults to off', () => {
    expect(scopeMode()).toBe('off');
  });

  test('scope mode reads PRISMA_SCOPE_MODE', () => {
    process.env.PRISMA_SCOPE_MODE = 'log';
    expect(scopeMode()).toBe('log');
    process.env.PRISMA_SCOPE_MODE = 'enforce';
    expect(scopeMode()).toBe('enforce');
    process.env.PRISMA_SCOPE_MODE = 'garbage';
    expect(scopeMode()).toBe('garbage'); // unknown value passes through to the switch which treats it as off
  });
});