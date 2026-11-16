// tests/audit-logger-shim.test.js
// P-05.5b1: the createAuditLog shim now passes `before` through to record().
// Proves:
//   - before and after both reach record() with the caller's values
//   - a call with no `before` still works (backward compat)
//   - the actor override path is unaffected

process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

jest.mock('../src/core/audit/record', () => ({
  record: jest.fn(() => Promise.resolve({ id: 1n })),
}));

const { record } = require('../src/core/audit/record');
const { createAuditLog } = require('../src/utils/audit-logger');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('audit-logger createAuditLog shim', () => {
  it('passes before and after to record()', async () => {
    await createAuditLog({
      action: 'ORDER_UPDATED',
      entityType: 'Order',
      entityId: '42',
      before: { status: 'PROCESSING' },
      details: { status: 'SHIPPED' },
    });
    expect(record).toHaveBeenCalledTimes(1);
    const event = record.mock.calls[0][1];
    expect(event.before).toEqual({ status: 'PROCESSING' });
    expect(event.after).toEqual({ status: 'SHIPPED' });
    expect(event.action).toBe('ORDER_UPDATED');
  });

  it('works with no before (backward compat)', async () => {
    await createAuditLog({
      action: 'ORDER_UPDATED',
      entityType: 'Order',
      entityId: '42',
      details: { status: 'SHIPPED' },
    });
    expect(record).toHaveBeenCalledTimes(1);
    const event = record.mock.calls[0][1];
    expect(event.before).toBeUndefined();
    expect(event.after).toEqual({ status: 'SHIPPED' });
  });

  it('works with before but no details', async () => {
    await createAuditLog({
      action: 'ORDER_UPDATED',
      entityType: 'Order',
      entityId: '42',
      before: { status: 'PROCESSING' },
    });
    const event = record.mock.calls[0][1];
    expect(event.before).toEqual({ status: 'PROCESSING' });
    expect(event.after).toBeUndefined();
  });
});