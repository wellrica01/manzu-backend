/**
 * Unit tests for the pharmacy push service (G4). No database, no network:
 * Prisma and the Expo sender are mocked.
 */

const mockPrisma = {
  pushToken: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
  processedWebhook: { create: jest.fn() },
  order: { findMany: jest.fn() },
};
jest.mock('../src/core/database/prisma', () => mockPrisma);

const mockSend = jest.fn();
jest.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken(t) { return typeof t === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(t); }
    chunkPushNotifications(m) { return [m]; }
    sendPushNotificationsAsync(chunk) { return mockSend(chunk); }
  }
  return { Expo };
});

const push = require('../src/domains/pharmacy/push/push.service');

const T1 = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const T2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('registerToken / unregisterToken', () => {
  test('rejects a non-Expo token with status 400', async () => {
    await expect(push.registerToken({ userId: 1, pharmacyId: 2, token: 'abc', platform: 'ios' }))
      .rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.pushToken.upsert).not.toHaveBeenCalled();
  });

  test('upserts by token so a device moves to the new user', async () => {
    await push.registerToken({ userId: 5, pharmacyId: 2, token: T1, platform: 'android' });
    const arg = mockPrisma.pushToken.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ token: T1 });
    expect(arg.update).toMatchObject({ userId: 5, pharmacyId: 2, platform: 'android' });
  });

  test('unregister only deletes the caller\'s own row', async () => {
    await push.unregisterToken({ userId: 5, pharmacyId: 2, token: T1 });
    expect(mockPrisma.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: T1, userId: 5, pharmacyId: 2 } });
  });
});

describe('notifyNewPaidOrders', () => {
  test('sends one push per order, with orderId payload and no customer data', async () => {
    mockPrisma.order.findMany.mockResolvedValue([{ id: 10, pharmacyId: 2 }]);
    mockPrisma.processedWebhook.create.mockResolvedValue({});
    mockPrisma.pushToken.findMany.mockResolvedValue([{ token: T1 }, { token: T2 }]);
    mockSend.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }]);

    await push.notifyNewPaidOrders([10]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const msgs = mockSend.mock.calls[0][0];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].data).toEqual({ type: 'order', orderId: 10 });
    expect(msgs[0].channelId).toBe('orders');
    expect(JSON.stringify(msgs[0])).not.toMatch(/phone|email|customer/i);
    // the order query only returns PAID + CONFIRMED orders
    expect(mockPrisma.order.findMany.mock.calls[0][0].where).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });
  });

  test('does not send twice when the order was already claimed (confirmOrder vs webhook)', async () => {
    mockPrisma.order.findMany.mockResolvedValue([{ id: 10, pharmacyId: 2 }]);
    mockPrisma.processedWebhook.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

    await push.notifyNewPaidOrders([10]);

    expect(mockSend).not.toHaveBeenCalled();
  });

  test('prunes tokens Expo reports as DeviceNotRegistered', async () => {
    mockPrisma.order.findMany.mockResolvedValue([{ id: 10, pharmacyId: 2 }]);
    mockPrisma.processedWebhook.create.mockResolvedValue({});
    mockPrisma.pushToken.findMany.mockResolvedValue([{ token: T1 }, { token: T2 }]);
    mockSend.mockResolvedValue([{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }]);

    await push.notifyNewPaidOrders([10]);

    expect(mockPrisma.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: [T2] } } });
  });

  test('never throws, and never logs a token, when Expo or the DB fails', async () => {
    mockPrisma.order.findMany.mockResolvedValue([{ id: 10, pharmacyId: 2 }]);
    mockPrisma.processedWebhook.create.mockResolvedValue({});
    mockPrisma.pushToken.findMany.mockResolvedValue([{ token: T1 }]);
    mockSend.mockRejectedValue(new Error(`"${T1}" is not a registered push notification recipient`));

    await expect(push.notifyNewPaidOrders([10])).resolves.toBeUndefined();

    const logged = JSON.stringify(console.error.mock.calls) + JSON.stringify(console.warn.mock.calls);
    expect(logged).not.toContain('aaaaaaaa');

    mockPrisma.order.findMany.mockRejectedValue(new Error('db down'));
    await expect(push.notifyNewPaidOrders([10])).resolves.toBeUndefined();
  });

  test('a pharmacy with no registered devices is a quiet no-op', async () => {
    mockPrisma.order.findMany.mockResolvedValue([{ id: 10, pharmacyId: 2 }]);
    mockPrisma.processedWebhook.create.mockResolvedValue({});
    mockPrisma.pushToken.findMany.mockResolvedValue([]);
    await push.notifyNewPaidOrders([10]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('notifyPaidOrdersByReferences', () => {
  test('resolves references to order ids, then notifies', async () => {
    mockPrisma.order.findMany
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ id: 10, pharmacyId: 2 }]);
    mockPrisma.processedWebhook.create.mockResolvedValue({});
    mockPrisma.pushToken.findMany.mockResolvedValue([{ token: T1 }]);
    mockSend.mockResolvedValue([{ status: 'ok' }]);

    await push.notifyPaidOrdersByReferences(['ref-1']);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
