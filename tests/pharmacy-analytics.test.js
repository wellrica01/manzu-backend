/**
 * Unit tests for the pharmacy analytics service (G8).
 * Repository and Prisma are mocked; no database.
 */

const mockRepo = {
  getOrderAnalytics: jest.fn(),
  getInventoryHealth: jest.fn(),
};
jest.mock('../src/domains/pharmacy/analytics/pharmacy-analytics.repository', () => mockRepo);

const service = require('../src/domains/pharmacy/analytics/pharmacy-analytics.service');

function orderAgg(overrides = {}) {
  return {
    totalRevenue: 100000,
    totalPrice: 110000,
    totalOrders: 10,
    uniqueCustomers: 5,
    returningCustomers: 2,
    statusGroups: [
      { status: 'COMPLETED', _count: { id: 6 } },
      { status: 'PROCESSING', _count: { id: 4 } },
    ],
    topMeds: [{ name: 'Paracetamol', count: 20, revenue: 2000 }],
    dailyRevenue: [{ day: '2026-11-09', revenue: 5000 }],
    ...overrides,
  };
}

function inventoryHealth() {
  return { totalItems: 12, lowStock: 3, outOfStock: 1, totalValue: 50000 };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.getInventoryHealth.mockResolvedValue(inventoryHealth());
});

describe('getAnalytics', () => {
  test('composes totals, AOV, retention, and preserves shapes', async () => {
    mockRepo.getOrderAnalytics.mockResolvedValue(orderAgg());
    const result = await service.getAnalytics(7, { from: '2026-11-01', to: '2026-11-10' });

    expect(result.period).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    expect(result.totalRevenue).toBe(100000);
    expect(result.totalOrders).toBe(10);
    expect(result.avgOrderValue).toBe(11000);
    expect(result.uniqueCustomers).toBe(5);
    expect(result.returningCustomers).toBe(2);
    expect(result.retentionRate).toBe(40);
    expect(result.statusCounts).toEqual([
      { status: 'COMPLETED', count: 6 },
      { status: 'PROCESSING', count: 4 },
    ]);
    expect(result.topMedications).toEqual([{ name: 'Paracetamol', count: 20, revenue: 2000 }]);
    expect(result.revenueByDay[0]).toMatchObject({ day: '2026-11-09', revenue: 5000 });
    expect(result.inventoryHealth).toEqual(inventoryHealth());
  });

  test('defaults to last 30 days when from/to missing', async () => {
    mockRepo.getOrderAnalytics.mockResolvedValue(orderAgg({ totalOrders: 0, totalPrice: 0, uniqueCustomers: 0, returningCustomers: 0 }));
    const result = await service.getAnalytics(7, {});
    expect(result.period.from).toBeDefined();
    expect(result.period.to).toBeDefined();
    expect(result.avgOrderValue).toBe(0);
    expect(result.retentionRate).toBe(0);
  });

  test('rejects invalid date format with 400 INVALID_DATE_RANGE', async () => {
    await expect(service.getAnalytics(7, { from: 'not-a-date', to: '2026-11-10' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_DATE_RANGE',
    });
    expect(mockRepo.getOrderAnalytics).not.toHaveBeenCalled();
  });

  test('rejects from > to with 400 INVALID_DATE_RANGE', async () => {
    await expect(service.getAnalytics(7, { from: '2026-11-10', to: '2026-11-01' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_DATE_RANGE',
    });
  });
});