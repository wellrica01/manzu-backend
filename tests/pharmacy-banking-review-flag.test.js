/**
 * P-08b: Pharmacy.bankReviewRequired is a derived flag.
 *
 * It is true if and only if the pharmacy has an open BankChange in REVIEW.
 * getEffectiveRecipient reads it to decide `held=true`. The flag is set by
 * requestBankChange (initial REVIEW) and markBankChangeReview, and cleared by
 * promoteBankChange and cancelBankChange(of a REVIEW row).
 *
 * These four tests pin the four transitions. If any of them regresses, a
 * pharmacy that should be blocked from payouts will look "held=false, no
 * recipient" instead - which is the failure mode P-08b exists to prevent.
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

const mockTx = {
  pharmacy: { update: jest.fn() },
  bankChange: { update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
};

jest.mock('../src/core/database/prisma', () => ({
  $transaction: jest.fn(async (cb) => cb(mockTx)),
  pharmacySetting: { findUnique: jest.fn().mockResolvedValue({ bankHoldHours: 48 }) },
}));

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../src/utils/audit-logger', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const axios = require('axios');
const service = require('../src/domains/pharmacy/banking/pharmacy-banking.service');

function mockPaystackMismatch() {
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/bank/resolve')) {
      return {
        data: { status: true, data: { account_name: 'Unrelated Ventures', account_number: '1234567890' } },
      };
    }
    return { data: { status: true, data: [{ name: 'First Bank', code: '011', slug: 'first-bank' }] } };
  });
  axios.post.mockResolvedValue({ data: { status: true, data: { recipient_code: 'RCP_new' } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  service._internal.resetBankCache();

  mockRepository.findPharmacyBanking.mockResolvedValue({
    id: 7, name: 'Test Pharmacy', recipientCode: null,
    bankAccountLast4: null, bankCode: null, bankName: null,
    accountName: null, bankReviewRequired: false,
  });
  mockRepository.findOpenBankChange.mockResolvedValue(null);
  mockRepository.findDueBankChanges.mockResolvedValue([]);
  mockRepository.hitThrottle.mockResolvedValue({ allowed: true, retryAfterMs: 0, count: 1, level: 0 });
  mockRepository.createBankChange.mockImplementation(async (data) => ({ id: 100, ...data, createdAt: new Date() }));
  mockRepository.promoteBankChange.mockResolvedValue(null);
  mockRepository.findBankChangeById.mockResolvedValue(null);
  mockRepository.cancelBankChange.mockResolvedValue(null);
});

afterEach(() => jest.restoreAllMocks());

const managerActor = { id: 1, pharmacyId: 7, role: 'MANAGER' };

describe('P-08b: Pharmacy.bankReviewRequired is maintained across transitions', () => {
  test('requestBankChange with MISMATCH sets Pharmacy.bankReviewRequired=true in the same tx', async () => {
    mockPaystackMismatch();

    await service.requestBankChange(7, managerActor, {
      accountNumber: '1234567890', bankCode: '011', bankName: 'First Bank', kind: 'SETUP',
    });

    // The row went to REVIEW.
    const rowArg = mockRepository.createBankChange.mock.calls[0][0];
    expect(rowArg.status).toBe('REVIEW');
    expect(rowArg.nameMatch).toBe('MISMATCH');

    // And the pharmacy flag was set in the same transaction.
    expect(mockTx.pharmacy.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { bankReviewRequired: true },
    });
  });

  test('requestBankChange with MATCH does NOT set Pharmacy.bankReviewRequired', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes('/bank/resolve')) {
        return { data: { status: true, data: { account_name: 'Test Pharmacy Ltd', account_number: '1234567890' } } };
      }
      return { data: { status: true, data: [{ name: 'First Bank', code: '011', slug: 'first-bank' }] } };
    });
    axios.post.mockResolvedValue({ data: { status: true, data: { recipient_code: 'RCP_new' } } });

    await service.requestBankChange(7, managerActor, {
      accountNumber: '1234567890', bankCode: '011', bankName: 'First Bank', kind: 'SETUP',
    });

    expect(mockTx.pharmacy.update).not.toHaveBeenCalled();
  });

  test('markBankChangeReview sets Pharmacy.bankReviewRequired=true', async () => {
    mockRepository.findBankChangeById.mockResolvedValue({
      id: 100, pharmacyId: 7, status: 'PENDING',
      holdUntil: new Date(Date.now() + 3600000),
    });

    await service.markReview(100, { id: 99, type: 'admin' }, 'suspicious');

    // The flag was set in the same transaction as the status flip.
    const flagCall = mockTx.pharmacy.update.mock.calls.find(
      ([arg]) => arg && arg.data && arg.data.bankReviewRequired === true
    );
    expect(flagCall).toBeDefined();
    expect(flagCall[0].where).toEqual({ id: 7 });
  });

  test('cancelBankChange of a REVIEW row clears Pharmacy.bankReviewRequired', async () => {
    mockRepository.findBankChangeById.mockResolvedValue({
      id: 100, pharmacyId: 7, status: 'REVIEW',
      holdUntil: new Date(Date.now() + 3600000),
    });
    mockRepository.cancelBankChange.mockResolvedValue({
      id: 100, pharmacyId: 7, status: 'CANCELLED', kind: 'UPDATE',
    });

    await service.cancelBankChange(7, managerActor, 100);

    const flagCall = mockTx.pharmacy.update.mock.calls.find(
      ([arg]) => arg && arg.data && arg.data.bankReviewRequired === false
    );
    expect(flagCall).toBeDefined();
    expect(flagCall[0].where).toEqual({ id: 7 });
  });

  test('cancelBankChange of a PENDING row does NOT touch Pharmacy.bankReviewRequired', async () => {
    mockRepository.findBankChangeById.mockResolvedValue({
      id: 100, pharmacyId: 7, status: 'PENDING',
      holdUntil: new Date(Date.now() + 3600000),
    });
    mockRepository.cancelBankChange.mockResolvedValue({
      id: 100, pharmacyId: 7, status: 'CANCELLED', kind: 'UPDATE',
    });

    await service.cancelBankChange(7, managerActor, 100);

    expect(mockTx.pharmacy.update).not.toHaveBeenCalled();
  });
});