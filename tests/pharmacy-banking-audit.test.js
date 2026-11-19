/**
 * P-08 audit redaction tests.
 *
 * These tests exist to prove one thing: the full account number never reaches
 * an audit event or log line. They do NOT prove the business logic of bank
 * changes - that is pharmacy-banking-repository.test.js and, once the routes
 * land, pharmacy-banking-routes.test.js.
 *
 * The mock reflects the real service interface after P-08:
 *   - hitThrottle is called before the Paystack resolve (spam guard).
 *   - findOpenBankChange is called before the insert (only one open change).
 *   - findPharmacyBanking returns the masked destination, never the full number.
 *   - getNigerianBanks performs a second axios.get (bank list); the mock
 *     distinguishes the two URLs so the bank-code membership check passes.
 *   - createBankChange + promoteBankChange are the lifecycle.
 *   - pharmacySetting.findUnique provides bankHoldHours (defaults to null here).
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
  updatePharmacyBanking: jest.fn(), // legacy shim, kept for symmetry
};

jest.mock('../src/domains/pharmacy/banking/pharmacy-banking.repository', () => mockRepository);

const mockTx = {
  pharmacy: { update: jest.fn() },
  bankChange: { update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
};

jest.mock('../src/core/database/prisma', () => ({
  $transaction: jest.fn(async (callback) => callback(mockTx)),
  pharmacySetting: { findUnique: jest.fn() },
}));

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock('../src/utils/audit-logger', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const axios = require('axios');
const { createAuditLog } = require('../src/utils/audit-logger');
const prismaMock = require('../src/core/database/prisma');
const service = require('../src/domains/pharmacy/banking/pharmacy-banking.service');

const ACCOUNT_NUMBER = '1234567890';
const BANK_CODE = '011';

// A URL-aware axios.get so /bank/resolve and /bank return different things.
// The default returns success for both. Tests that need a failure override
// only the /bank/resolve branch.
function mockAxiosGetSuccess() {
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/bank/resolve')) {
      return {
        data: {
          status: true,
          data: { account_name: 'Test Account', account_number: ACCOUNT_NUMBER },
        },
      };
    }
    if (url.includes('/bank')) {
      return {
        data: {
          status: true,
          data: [{ name: 'First Bank', code: BANK_CODE, slug: 'first-bank' }],
        },
      };
    }
    return { data: { status: false } };
  });
}

function mockAxiosGetResolveFailure() {
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/bank/resolve')) {
      return { data: { status: false, data: null } };
    }
    if (url.includes('/bank')) {
      return {
        data: {
          status: true,
          data: [{ name: 'First Bank', code: BANK_CODE, slug: 'first-bank' }],
        },
      };
    }
    return { data: { status: false } };
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  // Reset the in-memory bank list so cross-test state cannot leak.
  service._internal.resetBankCache();

  // --- Pharmacy lookup ---
  mockRepository.findPharmacyBanking.mockResolvedValue({
    id: 7,
    name: 'Test Pharmacy',
    recipientCode: null,
    bankAccountLast4: null,
    bankCode: null,
    bankName: null,
    accountName: null,
    bankReviewRequired: false,
  });

  // --- Bank-change lifecycle stubs ---
  mockRepository.findActiveRecipient.mockResolvedValue({
    id: 7,
    recipientCode: null,
    bankReviewRequired: false,
  });
  mockRepository.findOpenBankChange.mockResolvedValue(null);
  mockRepository.findDueBankChanges.mockResolvedValue([]);
  mockRepository.createBankChange.mockImplementation(async (data) => ({
    id: 42,
    ...data,
    createdAt: new Date(),
  }));
  mockRepository.promoteBankChange.mockImplementation(async (changeId) => ({
    change: {
      id: changeId,
      pharmacyId: 7,
      newAccountLast4: '7890',
      newBankName: 'First Bank',
    },
    activatedAt: new Date(),
  }));
  mockRepository.cancelBankChange.mockResolvedValue(null);
  mockRepository.findBankChangeById.mockResolvedValue(null);

  // --- Throttle ---
  mockRepository.hitThrottle.mockResolvedValue({
    allowed: true,
    retryAfterMs: 0,
    count: 1,
    level: 0,
  });
  mockRepository.resetThrottle.mockResolvedValue(undefined);

  // --- pharmacySetting read (service falls through to default on null) ---
  prismaMock.pharmacySetting.findUnique.mockResolvedValue(null);

  // --- Paystack ---
  mockAxiosGetSuccess();
  axios.post.mockResolvedValue({
    data: { status: true, data: { recipient_code: 'RCP_test123' } },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pharmacy banking audit account redaction', () => {
  test('setup audit event stores only the last four account digits', async () => {
    await service.setupBankAccount(7, {
      accountNumber: ACCOUNT_NUMBER,
      bankCode: BANK_CODE,
      bankName: 'First Bank',
    });

    const setupAuditCall = createAuditLog.mock.calls.find(
      ([event]) => event.action === 'BANKING_SETUP'
    );

    expect(setupAuditCall).toBeDefined();

    const details = setupAuditCall[0].details;

    expect(details.accountNumberLast4).toBe('7890');
    expect(details).not.toHaveProperty('accountNumber');
    expect(JSON.stringify(details)).not.toContain(ACCOUNT_NUMBER);
  });

  test('update audit event stores only the last four account digits', async () => {
    mockRepository.findPharmacyBanking.mockResolvedValue({
      id: 7,
      name: 'Test Pharmacy',
      recipientCode: 'RCP_old123',
      bankAccountLast4: null,
      bankCode: null,
      bankName: null,
      accountName: null,
      bankReviewRequired: false,
    });
    mockRepository.findActiveRecipient.mockResolvedValue({
      id: 7,
      recipientCode: 'RCP_old123',
      bankReviewRequired: false,
    });

    await service.updateBankAccount(7, {
      accountNumber: ACCOUNT_NUMBER,
      bankCode: BANK_CODE,
      bankName: 'First Bank',
    });

    const updateAuditCall = createAuditLog.mock.calls.find(
      ([event]) => event.action === 'BANKING_UPDATED'
    );

    expect(updateAuditCall).toBeDefined();

    const details = updateAuditCall[0].details;

    expect(details.accountNumberLast4).toBe('7890');
    expect(details).not.toHaveProperty('accountNumber');
    expect(JSON.stringify(details)).not.toContain(ACCOUNT_NUMBER);
  });

  test('verification failure audit event stores only the last four account digits', async () => {
    mockAxiosGetResolveFailure();

    await expect(
      service.setupBankAccount(7, {
        accountNumber: ACCOUNT_NUMBER,
        bankCode: BANK_CODE,
        bankName: 'First Bank',
      })
    ).rejects.toThrow(/Account verification failed/);

    const failedAuditCall = createAuditLog.mock.calls.find(
      ([event]) => event.action === 'BANKING_VERIFICATION_FAILED'
    );

    expect(failedAuditCall).toBeDefined();

    const details = failedAuditCall[0].details;

    expect(details.accountNumberLast4).toBe('7890');
    expect(details).not.toHaveProperty('accountNumber');
    expect(JSON.stringify(details)).not.toContain(ACCOUNT_NUMBER);
  });

  test('recipient creation failure audit event stores only the last four account digits', async () => {
    axios.post.mockResolvedValue({
      data: { status: false, data: null },
    });

    await expect(
      service.setupBankAccount(7, {
        accountNumber: ACCOUNT_NUMBER,
        bankCode: BANK_CODE,
        bankName: 'First Bank',
      })
    ).rejects.toThrow(/Failed to create recipient/);

    const failedAuditCall = createAuditLog.mock.calls.find(
      ([event]) => event.action === 'BANKING_VERIFICATION_FAILED'
    );

    expect(failedAuditCall).toBeDefined();

    const details = failedAuditCall[0].details;

    expect(details.accountNumberLast4).toBe('7890');
    expect(details).not.toHaveProperty('accountNumber');
    expect(JSON.stringify(details)).not.toContain(ACCOUNT_NUMBER);
  });
});