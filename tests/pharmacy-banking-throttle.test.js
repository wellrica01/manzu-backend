/**
 * P-08: rate-limit behaviour for bank changes (Doc 2 S6.1, S7.4).
 *
 * The invariant:
 *   - A pharmacy cannot make more than UPDATE_LIMIT_PER_DAY bank change requests.
 *   - Cancelling a pending change does NOT reset the daily counter, so a
 *     manager cannot verify -> cancel -> verify -> cancel in a loop to hit
 *     Paystack as a free lookup service.
 *
 * Throttle is delegated to core/throttle (Doc 1 F6). We mock hitThrottle's
 * response; the repository-layer throttle behaviour (that counters survive a
 * restart) is covered by tests for core/throttle.
 */

process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';

const mockRepository = {
  findPharmacyBanking: jest.fn(),
  findActiveRecipient: jest.fn(),
  findOpenBankChange: jest.fn(),
  findBankChangeById: jest.fn(),
  createBankChange: jest.fn(),
  cancelBankChange: jest.fn(),
  promoteBankChange: jest.fn(),
  findDueBankChanges: jest.fn(),
  hitThrottle: jest.fn(),
  resetThrottle: jest.fn(),
  updatePharmacyBanking: jest.fn(),
};

jest.mock('../src/domains/pharmacy/banking/pharmacy-banking.repository', () => mockRepository);

jest.mock('../src/core/database/prisma', () => ({
  $transaction: jest.fn(async (cb) => cb({ pharmacy: { update: jest.fn() }, bankChange: { update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() } })),
  pharmacySetting: { findUnique: jest.fn().mockResolvedValue({ bankHoldHours: 48 }) },
}));

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../src/utils/audit-logger', () => ({ createAuditLog: jest.fn().mockResolvedValue(undefined) }));

const service = require('../src/domains/pharmacy/banking/pharmacy-banking.service');

const managerActor = { id: 1, pharmacyId: 7, role: 'MANAGER' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  service._internal.resetBankCache();

  mockRepository.findPharmacyBanking.mockResolvedValue({
    id: 7, name: 'Test Pharmacy', recipientCode: 'RCP_old_123',
    bankAccountLast4: '3210', bankCode: '011', bankName: 'First Bank',
    accountName: 'Test Pharmacy Ltd', bankReviewRequired: false,
  });
  mockRepository.findOpenBankChange.mockResolvedValue(null);
  mockRepository.findDueBankChanges.mockResolvedValue([]);
  mockRepository.createBankChange.mockImplementation(async (data) => ({ id: 100, ...data, createdAt: new Date() }));
  mockRepository.promoteBankChange.mockResolvedValue(null);
  mockRepository.findBankChangeById.mockResolvedValue(null);
  mockRepository.cancelBankChange.mockResolvedValue(null);
});

afterEach(() => jest.restoreAllMocks());

describe('P-08 throttle: bank change requests per day', () => {
  test('4th request in a day returns BANK_LOCKED with retryAfterMs', async () => {
    // hitThrottle returns a deny with retryAfterMs.
    mockRepository.hitThrottle.mockResolvedValue({
      allowed: false,
      retryAfterMs: 3 * 60 * 60 * 1000, // 3h to end of window
      count: 4,
      level: 1,
    });

    await expect(
      service.requestBankChange(7, managerActor, {
        accountNumber: '1234567890', bankCode: '011', bankName: 'First Bank', kind: 'UPDATE',
      })
    ).rejects.toMatchObject({
      code: 'BANK_LOCKED',
      status: 429,
      retryAfterMs: expect.any(Number),
    });
  });

  test('throttle denied BEFORE the Paystack call (no free lookup)', async () => {
    mockRepository.hitThrottle.mockResolvedValue({
      allowed: false, retryAfterMs: 60000, count: 4, level: 1,
    });

    const axios = require('axios');
    await expect(
      service.requestBankChange(7, managerActor, {
        accountNumber: '1234567890', bankCode: '011', bankName: 'First Bank', kind: 'UPDATE',
      })
    ).rejects.toMatchObject({ code: 'BANK_LOCKED' });

    // No Paystack call, no pharmacy lookup beyond the throttle check.
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('cancelBankChange does not reset the daily counter', async () => {
    // Simulate the counter sitting at 3 hits.
    mockRepository.hitThrottle.mockResolvedValue({ allowed: true, retryAfterMs: 0, count: 3, level: 0 });
    mockRepository.findBankChangeById.mockResolvedValue({
      id: 100, pharmacyId: 7, status: 'PENDING', holdUntil: new Date(Date.now() + 3600000),
    });
    mockRepository.cancelBankChange.mockResolvedValue({
      id: 100, pharmacyId: 7, status: 'CANCELLED', kind: 'UPDATE',
      newBankName: 'First Bank', newAccountLast4: '7890', newAccountName: 'Test Pharmacy Ltd',
      nameMatch: 'MATCH', holdUntil: new Date(),
    });

    const cancelled = await service.cancelBankChange(7, managerActor, 100);
    expect(cancelled.status).toBe('CANCELLED');

    // resetThrottle must NOT have been called - the daily counter is untouched.
    expect(mockRepository.resetThrottle).not.toHaveBeenCalled();
  });
});