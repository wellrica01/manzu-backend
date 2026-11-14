// tests/audit-core.test.js
// Proves the write path: buildRow shape, fail-closed semantics, never-throw
// for security events, flood limit. Pure Node, no database (fake tx).

const { buildRow, record } = require('../src/core/audit/record');
const security = require('../src/core/audit/security-event');
const { runWithContext } = require('../src/core/context/actor-context');

function fakeTx(behaviour) {
  const calls = [];
  return {
    calls,
    auditEvent: {
      create: async ({ data }) => {
        calls.push(data);
        if (behaviour === 'throw') {
          const e = new Error('db down');
          throw e;
        }
        return { id: 1n, ...data };
      },
    },
  };
}

describe('audit.record', () => {
  it('buildRow takes the actor from context', async () => {
    const ctx = {
      requestId: 'req-1',
      actor: {
        type: 'pharmacy_user',
        id: 10,
        pharmacyId: 3,
        role: 'MANAGER',
        sessionId: 'sess-1',
        deviceId: 'dev-1',
        ip: '1.2.3.4',
        userAgent: 'ua',
        label: 'Ada',
      },
    };
    const row = await new Promise((resolve, reject) => {
      try {
        runWithContext(ctx, () => resolve(buildRow({ action: 'ORDER_UPDATED', entityType: 'Order', entityId: 42 })));
      } catch (e) { reject(e); }
    });
    expect(row.actorType).toBe('pharmacy_user');
    expect(row.actorId).toBe('10');
    expect(row.actorRole).toBe('MANAGER');
    expect(row.actorLabel).toBe('Ada');
    expect(row.pharmacyId).toBe(3);
    expect(row.sessionId).toBe('sess-1');
    expect(row.deviceId).toBe('dev-1');
    expect(row.ip).toBe('1.2.3.4');
    expect(row.requestId).toBe('req-1');
    expect(row.entityId).toBe('42');
  });

  it('buildRow falls back to system actor when no context', () => {
    const row = buildRow({ action: 'ORDER_UPDATED', entityType: 'Order' });
    expect(row.actorType).toBe('system');
    expect(row.actorId).toBeNull();
    expect(row.pharmacyId).toBeNull();
  });

  it('rejects invalid outcome and severity', () => {
    expect(() => buildRow({ action: 'ORDER_UPDATED', entityType: 'Order', outcome: 'maybe' })).toThrow();
    expect(() => buildRow({ action: 'ORDER_UPDATED', entityType: 'Order', severity: 'fatal' })).toThrow();
  });

  it('rejects missing action or entityType', () => {
    expect(() => buildRow({ entityType: 'Order' })).toThrow();
    expect(() => buildRow({ action: 'ORDER_UPDATED' })).toThrow();
  });

  it('fail-closed action throws on write error', async () => {
    const tx = fakeTx('throw');
    await expect(record(tx, { action: 'PAYMENT_VERIFIED', entityType: 'Payment', entityId: 5 })).rejects.toThrow();
    expect(tx.calls.length).toBe(1);
  });

  it('best-effort action swallows write error', async () => {
    const tx = fakeTx('throw');
    const silent = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await record(tx, { action: 'ORDER_CREATED', entityType: 'Order', entityId: 42 });
    expect(out).toBeNull();
    silent.mockRestore();
  });

  it('requires a transaction client', async () => {
    await expect(record(null, { action: 'ORDER_CREATED', entityType: 'Order' })).rejects.toThrow();
    await expect(record({}, { action: 'ORDER_CREATED', entityType: 'Order' })).rejects.toThrow();
  });

  it('writes a row on success', async () => {
    const tx = fakeTx('ok');
    const out = await record(tx, { action: 'ORDER_CREATED', entityType: 'Order', entityId: 42 });
    expect(out).toBeTruthy();
    expect(tx.calls[0].action).toBe('ORDER_CREATED');
    expect(tx.calls[0].kind).toBe('audit');
  });

  it('record() accepts an explicit actor override', async () => {
    const tx = fakeTx('ok');
    const override = { type: 'pharmacy_user', id: 99, role: 'MANAGER', pharmacyId: 7 };
    await record(
      tx,
      { action: 'ORDER_CREATED', entityType: 'Order', entityId: 42 },
      { actor: override }
    );
    expect(tx.calls[0].actorType).toBe('pharmacy_user');
    expect(tx.calls[0].actorId).toBe('99');
    expect(tx.calls[0].actorRole).toBe('MANAGER');
    expect(tx.calls[0].pharmacyId).toBe(7);
  });

  it('record() with no override and no context writes system', async () => {
    const tx = fakeTx('ok');
    await record(tx, { action: 'ORDER_CREATED', entityType: 'Order', entityId: 42 });
    expect(tx.calls[0].actorType).toBe('system');
    expect(tx.calls[0].actorId).toBeNull();
  });
});

describe('security.record', () => {
  it('never throws even when the write fails', async () => {
    const tx = fakeTx('throw');
    const silent = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await security.record(tx, { action: 'RATE_LIMITED', entityType: 'Auth' });
    expect(out).toBeNull();
    silent.mockRestore();
  });

  it('marks the event as kind=security', async () => {
    const tx = fakeTx('ok');
    await security.record(tx, { action: 'RATE_LIMITED', entityType: 'Auth', entityId: '1.2.3.4' });
    expect(tx.calls[0].kind).toBe('security');
    expect(tx.calls[0].severity).toBe('warning');
  });

  it('does not throw when the event is malformed', async () => {
    const tx = fakeTx('ok');
    const out = await security.record(tx, null);
    expect(out).toBeNull();
    expect(tx.calls.length).toBe(0);
  });

  it('notify is a no-op sink, no throw', () => {
    const silent = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(security.notify({ action: 'x', severity: 'warning' })).toBeNull();
    silent.mockRestore();
  });
});