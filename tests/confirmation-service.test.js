const mockPrisma = {
  transactionReference: { findFirst: jest.fn() },
  order: { findMany: jest.fn() },
  processedWebhook: { findUnique: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}), { virtual: true });
jest.mock('axios', () => ({}), { virtual: true });
jest.mock('../src/utils/validation', () => ({
  isValidOrderReference: jest.fn(() => true),
}));
jest.mock('../src/utils/tracking', () => ({
  generateTrackingCode: jest.fn(() => 'tracking-code'),
}));
jest.mock('../src/utils/medicationUtils', () => ({
  capitalize: jest.fn(value => value),
  formatPerUnitType: jest.fn(value => value),
  formatPackSizeUnit: jest.fn(value => value),
  formatStrengthUnit: jest.fn(value => value),
}));
jest.mock('../src/utils/audit-logger', () => ({
  createAuditLog: jest.fn(),
  AUDIT_ACTIONS: {},
  ENTITY_TYPES: {},
}));
jest.mock('../src/utils/error-reporter', () => ({
  alertPaymentVerificationFailed: jest.fn(),
  alertPaymentGatewayDown: jest.fn(),
}));
jest.mock('../src/domains/pharmacy/push/push.service', () => ({
  notifyNewPaidOrders: jest.fn(),
}));

const { confirmOrder } = require('../src/services/confirmationService');

const session = 'checkout-session-123';
const reference = 'session_checkout-session-123_1712345678901';
const transactionRef = {
  transactionReference: reference,
  orderReferences: ['order-1'],
  checkoutSessionId: session,
};

function makeOrder() {
  return {
    id: 1,
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    trackingCode: 'tracking-code',
    totalPrice: 1200,
    pharmacyId: 7,
    Pharmacy: { name: 'Test pharmacy', OperatingHour: [] },
    OrderItem: [],
    Prescription: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('confirmOrder', () => {
  test('retrieves transaction-linked orders when the guest ID has changed', async () => {
    mockPrisma.transactionReference.findFirst.mockResolvedValue(transactionRef);
    mockPrisma.order.findMany.mockResolvedValue([makeOrder()]);
    mockPrisma.processedWebhook.findUnique.mockResolvedValue({ eventId: `verification_${reference}` });

    const result = await confirmOrder({
      reference,
      session,
      userId: 'different-guest-id',
    });

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          checkoutSessionId: session,
          paymentReference: { in: transactionRef.orderReferences },
        },
      })
    );
    expect(result.status).toBe('COMPLETED');
    expect(result.pharmacies).toHaveLength(1);
  });

  test('rejects a transaction reference paired with a different session', async () => {
    mockPrisma.transactionReference.findFirst.mockResolvedValue(transactionRef);

    await expect(
      confirmOrder({
        reference,
        session: 'another-session',
        userId: 'guest-id',
      })
    ).rejects.toThrow('Transaction reference does not match checkout session');

    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
  });

  test('keeps session-only lookup scoped to the guest ID', async () => {
    mockPrisma.order.findMany.mockResolvedValue([]);

    await expect(
      confirmOrder({
        session,
        userId: 'guest-id',
      })
    ).rejects.toThrow('Orders not found');

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userIdentifier: 'guest-id',
          checkoutSessionId: session,
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
      })
    );
  });
});
