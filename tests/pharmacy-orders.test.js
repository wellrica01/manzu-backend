/**
 * Unit tests for pharmacy order status updates (G7, G10).
 * No database: repository and Prisma are mocked.
 * Run with the same inline config used for the other suites.
 */

process.env.JWT_SECRET = 'test-secret';

const mockRepo = {
  findOrderForUpdate: jest.fn(),
  updateOrderStatus: jest.fn(),
  updateOrderStatusWithTransaction: jest.fn(),
  restoreStock: jest.fn(),
  createRefund: jest.fn(),
};

jest.mock('../src/domains/pharmacy/orders/pharmacy-orders.repository', () => mockRepo);

const mockPrismaTx = {
  order: { update: jest.fn() },
};
jest.mock('../src/core/database/prisma', () => ({
  $transaction: jest.fn(async (fn) => fn(mockPrismaTx)),
}));

const mockRefundService = { processRefund: jest.fn() };
jest.mock('../src/services/refundService', () => mockRefundService);

jest.mock('../src/utils/notifications', () => ({ sendOrderRejectionNotification: jest.fn() }));
jest.mock('../src/utils/audit-logger', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
  ENTITY_TYPES: { ORDER: 'ORDER' },
}));

const service = require('../src/domains/pharmacy/orders/pharmacy-orders.service');

function order(overrides = {}) {
  return {
    id: 1,
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    deliveryMethod: 'COURIER',
    totalPrice: 3000,
    pharmacyId: 7,
    OrderItem: [
      { medicationId: 10, pharmacyId: 7, quantity: 2, MedicationAvailability: { Medication: { brandName: 'Paracetamol' } } },
    ],
    Pharmacy: { name: 'Test Pharmacy' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('assertValidTransition (via updateOrderStatus)', () => {
  test('rejects CONFIRMED -> DELIVERED (must go PROCESSING -> SHIPPED -> DELIVERED)', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'CONFIRMED', deliveryMethod: 'COURIER' }));
    await expect(service.updateOrderStatus(1, 'DELIVERED', 7)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_STATUS_TRANSITION',
    });
    expect(mockRepo.updateOrderStatus).not.toHaveBeenCalled();
  });

  test('rejects COURIER order to READY_FOR_PICKUP', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'PROCESSING', deliveryMethod: 'COURIER' }));
    await expect(service.updateOrderStatus(1, 'READY_FOR_PICKUP', 7)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_STATUS_TRANSITION',
    });
  });

  test('rejects PICKUP order to SHIPPED', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'PROCESSING', deliveryMethod: 'PICKUP' }));
    await expect(service.updateOrderStatus(1, 'SHIPPED', 7)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_STATUS_TRANSITION',
    });
  });

  test('rejects COMPLETED -> CANCELLED (money already settled)', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'COMPLETED' }));
    await expect(service.updateOrderStatus(1, 'CANCELLED', 7)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_STATUS_TRANSITION',
    });
  });

  test('allows CONFIRMED -> PROCESSING (COURIER)', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'CONFIRMED', deliveryMethod: 'COURIER' }));
    mockRepo.updateOrderStatus.mockResolvedValue({ ...order(), status: 'PROCESSING' });
    await service.updateOrderStatus(1, 'PROCESSING', 7);
    expect(mockRepo.updateOrderStatus).toHaveBeenCalledWith(1, { status: 'PROCESSING' });
  });

  test('allows PROCESSING -> READY_FOR_PICKUP (PICKUP)', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'PROCESSING', deliveryMethod: 'PICKUP' }));
    mockRepo.updateOrderStatus.mockResolvedValue({ ...order(), status: 'READY_FOR_PICKUP' });
    await service.updateOrderStatus(1, 'READY_FOR_PICKUP', 7);
    expect(mockRepo.updateOrderStatus).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'READY_FOR_PICKUP' }));
  });
});

describe('idempotency', () => {
  test('same-status update is rejected with 409', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'PROCESSING' }));
    await expect(service.updateOrderStatus(1, 'PROCESSING', 7)).rejects.toMatchObject({
      status: 409,
      code: 'STATUS_UNCHANGED',
    });
    expect(mockRepo.updateOrderStatus).not.toHaveBeenCalled();
  });

  test('missing order returns 404 ORDER_NOT_FOUND', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(null);
    await expect(service.updateOrderStatus(999, 'PROCESSING', 7)).rejects.toMatchObject({
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
  });
});

describe('G7: cancelReason and unpaid restock', () => {
  test('unpaid cancel restocks items and does NOT create a refund', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'PROCESSING', paymentStatus: 'PENDING' }));
    mockRepo.updateOrderStatusWithTransaction.mockImplementation(async (id, phId, data) => ({ ...order(), ...data }));
    mockRepo.restoreStock.mockResolvedValue(undefined);

    await service.updateOrderStatus(1, 'CANCELLED', 7, 'Out of stock today');

    expect(mockRepo.updateOrderStatusWithTransaction).toHaveBeenCalledWith(
      1,
      7,
      expect.objectContaining({ status: 'CANCELLED', cancelReason: 'Out of stock today' }),
      expect.anything(),
    );
    expect(mockRepo.restoreStock).toHaveBeenCalledWith(10, 7, 2, expect.anything());
    expect(mockRepo.createRefund).not.toHaveBeenCalled();
  });

  test('paid cancel creates refund and restocks, with the supplied cancelReason', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'PROCESSING', paymentStatus: 'PAID' }));
    mockRepo.updateOrderStatusWithTransaction.mockImplementation(async (id, phId, data) => ({ ...order(), ...data }));
    mockRepo.createRefund.mockResolvedValue({ id: 42, amount: 3000 });
    mockRepo.restoreStock.mockResolvedValue(undefined);

    await service.updateOrderStatus(1, 'CANCELLED', 7, 'Customer requested refund');

    expect(mockRepo.restoreStock).toHaveBeenCalledWith(10, 7, 2, expect.anything());
    expect(mockRepo.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Customer requested refund' }),
      expect.anything(),
    );
  });

  test('paid cancel without explicit reason falls back to "Pharmacy rejected order"', async () => {
    mockRepo.findOrderForUpdate.mockResolvedValue(order({ status: 'PROCESSING', paymentStatus: 'PAID' }));
    mockRepo.updateOrderStatusWithTransaction.mockImplementation(async (id, phId, data) => ({ ...order(), ...data }));
    mockRepo.createRefund.mockResolvedValue({ id: 42, amount: 3000 });
    mockRepo.restoreStock.mockResolvedValue(undefined);

    await service.updateOrderStatus(1, 'CANCELLED', 7);

    expect(mockRepo.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Pharmacy rejected order' }),
      expect.anything(),
    );
  });
});

describe('bulkUpdateOrderStatus: G10 also applies', () => {
  test('invalid transition on one order is recorded as a failure, others proceed', async () => {
    mockRepo.findOrderForUpdate
      .mockResolvedValueOnce(order({ id: 1, status: 'COMPLETED' })) // invalid: COMPLETED -> PROCESSING
      .mockResolvedValueOnce(order({ id: 2, status: 'CONFIRMED', deliveryMethod: 'COURIER' })); // valid
    mockRepo.updateOrderStatus.mockResolvedValue({ ...order(), status: 'PROCESSING' });

    const result = await service.bulkUpdateOrderStatus([1, 2], 'PROCESSING', 7);

    expect(result.successful.map((r) => r.orderId)).toEqual([2]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ orderId: 1 });
    expect(result.failed[0].reason).toMatch(/COMPLETED to PROCESSING/);
  });
});