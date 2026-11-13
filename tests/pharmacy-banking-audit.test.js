
process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';

const mockRepository = {
  findPharmacyBanking: jest.fn(),
  updatePharmacyBanking: jest.fn(),
};

jest.mock('../src/domains/pharmacy/banking/pharmacy-banking.repository', () => mockRepository);

const mockTx = {
  pharmacy: { update: jest.fn() },
};

jest.mock('../src/core/database/prisma', () => ({
  $transaction: jest.fn(async (callback) => callback(mockTx)),
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
const service = require('../src/domains/pharmacy/banking/pharmacy-banking.service');

const ACCOUNT_NUMBER = '1234567890';

beforeEach(() => {
  jest.clearAllMocks();

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  mockRepository.findPharmacyBanking.mockResolvedValue({
    id: 7,
    name: 'Test Pharmacy',
    recipientCode: null,
  });

  mockRepository.updatePharmacyBanking.mockResolvedValue({ id: 7 });

  axios.get.mockResolvedValue({
    data: {
      status: true,
      data: {
        account_name: 'Test Account',
        account_number: ACCOUNT_NUMBER,
      },
    },
  });

  axios.post.mockResolvedValue({
    data: {
      status: true,
      data: { recipient_code: 'RCP_test123' },
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pharmacy banking audit account redaction', () => {
  test('setup audit event stores only the last four account digits', async () => {
    await service.setupBankAccount(7, {
      accountNumber: ACCOUNT_NUMBER,
      bankCode: '011',
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
    });

    await service.updateBankAccount(7, {
      accountNumber: ACCOUNT_NUMBER,
      bankCode: '011',
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
    axios.get.mockResolvedValue({
      data: {
        status: false,
        data: null,
      },
    });

    await expect(
      service.setupBankAccount(7, {
        accountNumber: ACCOUNT_NUMBER,
        bankCode: '011',
        bankName: 'First Bank',
      })
    ).rejects.toThrow('Account verification failed');

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
      data: {
        status: false,
        data: null,
      },
    });

    await expect(
      service.setupBankAccount(7, {
        accountNumber: ACCOUNT_NUMBER,
        bankCode: '011',
        bankName: 'First Bank',
      })
    ).rejects.toThrow('Failed to create recipient');

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
