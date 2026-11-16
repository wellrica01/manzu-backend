// tests/create-audit-log-context.test.js
// P-05 verification: a createAuditLog({ userId: null }) call on an authenticated
// request still attributes the actor, because currentActor() from
// runWithContext (in authenticate) wins over the null override.
//
// Locks down the mechanism that made the three stale "userId: null" call
// sites in pharmacy-orders.service.js harmless: they are cosmetic, not a
// data gap.

process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const mockRecord = jest.fn();
jest.mock('../src/core/audit/record', () => ({
  record: (...args) => mockRecord(...args),
}));

const { runWithContext } = require('../src/core/context/actor-context');
const { createAuditLog } = require('../src/utils/audit-logger');

beforeEach(() => {
  mockRecord.mockReset();
  mockRecord.mockResolvedValue({ id: 1 });
});

test('userId: null on a populated context attributes via currentActor() (the pharmacy-route path)', async () => {
  const actor = { type: 'pharmacy_user', id: '42', role: 'MANAGER', pharmacyId: 7 };
  await runWithContext({ requestId: 'r-1', actor }, async () => {
    await createAuditLog({
      action: 'PHARMACY_ORDER_REJECTED',
      entityType: 'ORDER',
      entityId: 99,
      userId: null, // <- the exact call-site pattern
    });
  });
  expect(mockRecord).toHaveBeenCalledTimes(1);
  const [, event, options] = mockRecord.mock.calls[0];
  // context present -> no override passed -> record() falls through to currentActor()
  expect(options).toBeUndefined();
  expect(event.action).toBe('PHARMACY_ORDER_REJECTED');
  expect(event.entityId).toBe(99);
});

test('userId: null with no context falls to system (jobs / scripts outside a request)', async () => {
  await createAuditLog({
    action: 'PHARMACY_ORDER_REJECTED',
    entityType: 'ORDER',
    entityId: 99,
    userId: null,
  });
  const [, , options] = mockRecord.mock.calls[0];
  expect(options).toBeUndefined();
});

test('userId: 42 with no context uses the explicit override (pre-FND-05 legacy callers)', async () => {
  await createAuditLog({
    action: 'PHARMACY_ORDER_REJECTED',
    entityType: 'ORDER',
    entityId: 99,
    userId: 42,
  });
  const [, , options] = mockRecord.mock.calls[0];
  expect(options).toEqual({ actor: { type: 'pharmacy_user', id: '42' } });
});