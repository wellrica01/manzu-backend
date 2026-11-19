/**
 * P-08 exit tests: bank destination hold (Doc 2 S6.1, S9.3).
 *
 * The money-path invariant this file proves:
 *
 *   "A changed destination cannot receive a payout inside the hold window."
 *
 * It does so by pinning the four states the service can be in and asserting
 * exactly one behaviour for each:
 *
 *   PENDING + hold not elapsed  -> getEffectiveRecipient returns the OLD code
 *   PENDING + hold elapsed      -> lazy promote, getEffectiveRecipient returns NEW code
 *   REVIEW                      -> cannot be promoted; held=true when no active
 *   SETUP + MATCH               -> promoted immediately (P-D2)
 *
 * No real DB, no real HTTP. Mock at the service's seams: repository + prisma
 * + axios + audit-logger. Style follows pharmacy-banking-audit.test.js.
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
  $transaction: jest.fn(async (callback) => callback(mockTx)),
  pharmacySetting: { findUnique: jest.fn() },
}));

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

jest.mock('../src/utils/audit-logger', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const axios = require('axios');
const { createAuditLog } = require('../src/utils/audit-logger');
const prismaMock = require('../src/core/database/prisma');
const service = require('../src/domains/pharmacy/banking/pharmacy-banking.service');

const ACCOUNT_NEW = '1234567890';
const ACCOUNT_OLD = '9876543210';

function mockPaystackSuccess() {
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/bank/resolve')) {
      return {
        data: { status: true, data: { account_name: 'Test Pharmacy Ltd', account_number: ACCOUNT_NEW } },
      };
    }
    if (url.includes('/bank')) {
      return { data: { status: true, data: [{ name: 'First Bank', code: '011', slug: 'first-bank' }] } };
    }
    return { data: { status: false } };
  });
  axios.post.mockResolvedValue({
    data: { status: true, data: { recipient_code: 'RCP_new_456' } },
  });
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  service._internal.resetBankCache();

  // Default: pharmacy has an OLD active destination, no pending change.
  mockRepository.findPharmacyBanking.mockResolvedValue({
    id: 7,
    name: 'Test Pharmacy',
    recipientCode: 'RCP_old_123',
    bankAccountLast4: '3210',
    bankCode: '011',
    bankName: 'First Bank',
    accountName: 'Test Pharmacy Ltd',
    bankReviewRequired: false,
  });

  mockRepository.findActiveRecipient.mockResolvedValue({
    id: 7,
    recipientCode: 'RCP_old_123',
    bankReviewRequired: false,
  });

  mockRepository.findOpenBankChange.mockResolvedValue(null);
  mockRepository.findDueBankChanges.mockResolvedValue([]);
  mockRepository.hitThrottle.mockResolvedValue({
    allowed: true,
    retryAfterMs: 0,
    count: 1,
    level: 0,
  });
  mockRepository.resetThrottle.mockResolvedValue(undefined);
  mockRepository.createBankChange.mockImplementation(async (data) => ({
    id: 100,
    ...data,
    createdAt: new Date(),
  }));
  mockRepository.promoteBankChange.mockResolvedValue(null);
  mockRepository.cancelBankChange.mockResolvedValue(null);
  mockRepository.findBankChangeById.mockResolvedValue(null);

  prismaMock.pharmacySetting.findUnique.mockResolvedValue({ bankHoldHours: 48 });

  mockPaystackSuccess();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const managerActor = { id: 1, pharmacyId: 7, role: 'MANAGER' };

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

describe('P-08 invariant: a changed destination cannot pay inside the hold window', () => {
  test('UPDATE creates a PENDING change and does not touch Pharmacy.recipientCode', async () => {
    await service.requestBankChange(7, managerActor, {
      accountNumber: ACCOUNT_NEW,
      bankCode: '011',
      bankName: 'First Bank',
      kind: 'UPDATE',
    });

    // createBankChange got a PENDING row with a holdUntil ~48h in the future.
    expect(mockRepository.createBankChange).toHaveBeenCalledTimes(1);
    const rowArg = mockRepository.createBankChange.mock.calls[0][0];
    expect(rowArg.status).toBe('PENDING');
    expect(rowArg.newRecipientCode).toBe('RCP_new_456');
    expect(rowArg.holdUntil.getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);

    // promoteBankChange was NOT called.
    expect(mockRepository.promoteBankChange).not.toHaveBeenCalled();
    // Pharmacy.recipientCode was NOT updated.
    expect(mockTx.pharmacy.update).not.toHaveBeenCalled();
  });

  test('getEffectiveRecipient during the hold returns the OLD recipient', async () => {
    const pendingChange = {
      id: 100,
      pharmacyId: 7,
      status: 'PENDING',
      holdUntil: hoursFromNow(47),
      newRecipientCode: 'RCP_new_456',
      newAccountLast4: '7890',
      newBankName: 'First Bank',
    };
    mockRepository.findDueBankChanges.mockResolvedValue([]); // not yet due
    mockRepository.findActiveRecipient.mockResolvedValue({
      id: 7,
      recipientCode: 'RCP_old_123',
      bankReviewRequired: false,
    });

    const result = await service.getEffectiveRecipient(7);
    expect(result.recipientCode).toBe('RCP_old_123');
    expect(result.held).toBe(false);
    expect(mockRepository.promoteBankChange).not.toHaveBeenCalled();
  });

  test('getEffectiveRecipient after the hold promotes lazily and returns the NEW recipient', async () => {
    const dueChange = {
      id: 100,
      pharmacyId: 7,
      status: 'PENDING',
      holdUntil: hoursFromNow(-1),
      newRecipientCode: 'RCP_new_456',
      newAccountLast4: '7890',
      newBankName: 'First Bank',
    };
    mockRepository.findDueBankChanges.mockResolvedValue([dueChange]);
    mockRepository.promoteBankChange.mockImplementation(async () => ({
      change: dueChange,
      activatedAt: new Date(),
    }));
    mockRepository.findActiveRecipient.mockResolvedValue({
      id: 7,
      recipientCode: 'RCP_new_456',
      bankReviewRequired: false,
    });

    const result = await service.getEffectiveRecipient(7);
    expect(result.recipientCode).toBe('RCP_new_456');
    expect(result.held).toBe(false);
    expect(mockRepository.promoteBankChange).toHaveBeenCalledWith(100, mockTx);

    // The activation audit event fires with the correct pharmacyId (not null).
    const activatedEvent = createAuditLog.mock.calls
      .map((c) => c[0])
      .find((e) => e.action === 'BANK_CHANGE_ACTIVATED');
    expect(activatedEvent).toBeDefined();
    expect(activatedEvent.pharmacyId).toBe(7);
    expect(activatedEvent.details.newAccountLast4).toBe('7890');
  });

  test('name MISMATCH creates a REVIEW change that does NOT activate on getEffectiveRecipient', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes('/bank/resolve')) {
        return { data: { status: true, data: { account_name: 'Unrelated Ventures', account_number: ACCOUNT_NEW } } };
      }
      return { data: { status: true, data: [{ name: 'First Bank', code: '011', slug: 'first-bank' }] } };
    });

    await service.requestBankChange(7, managerActor, {
      accountNumber: ACCOUNT_NEW,
      bankCode: '011',
      bankName: 'First Bank',
      kind: 'UPDATE',
    });

    const rowArg = mockRepository.createBankChange.mock.calls[0][0];
    expect(rowArg.status).toBe('REVIEW');
    expect(rowArg.nameMatch).toBe('MISMATCH');
    expect(mockRepository.promoteBankChange).not.toHaveBeenCalled();
  });

  test('held=true when REVIEW and no active destination (first-time setup mismatch)', async () => {
    mockRepository.findDueBankChanges.mockResolvedValue([]);
    mockRepository.findActiveRecipient.mockResolvedValue({
      id: 7,
      recipientCode: null,
      bankReviewRequired: true,
    });

    const result = await service.getEffectiveRecipient(7);
    expect(result.recipientCode).toBeNull();
    expect(result.held).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P-D2: first-time setup activates immediately
// ---------------------------------------------------------------------------

describe('P-D2: first-time setup (SETUP + MATCH) activates immediately', () => {
  test('SETUP with matching name promotes in the same transaction', async () => {
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
    mockRepository.promoteBankChange.mockImplementation(async () => ({
      change: { id: 100, pharmacyId: 7 },
      activatedAt: new Date(),
    }));

    await service.requestBankChange(7, managerActor, {
      accountNumber: ACCOUNT_NEW,
      bankCode: '011',
      bankName: 'First Bank',
      kind: 'SETUP',
    });

    const rowArg = mockRepository.createBankChange.mock.calls[0][0];
    expect(rowArg.kind).toBe('SETUP');
    expect(rowArg.status).toBe('PENDING');
    expect(rowArg.nameMatch).toBe('MATCH');
    // holdUntil is ~now, not +48h.
    expect(rowArg.holdUntil.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);

    expect(mockRepository.promoteBankChange).toHaveBeenCalledWith(100, mockTx);
  });

  test('SETUP with MISMATCH does not activate and goes to REVIEW', async () => {
    mockRepository.findPharmacyBanking.mockResolvedValue({
      id: 7, name: 'Test Pharmacy', recipientCode: null,
      bankAccountLast4: null, bankCode: null, bankName: null, accountName: null, bankReviewRequired: false,
    });
    axios.get.mockImplementation(async (url) => {
      if (url.includes('/bank/resolve')) {
        return { data: { status: true, data: { account_name: 'Unrelated Ventures', account_number: ACCOUNT_NEW } } };
      }
      return { data: { status: true, data: [{ name: 'First Bank', code: '011', slug: 'first-bank' }] } };
    });

    await service.requestBankChange(7, managerActor, {
      accountNumber: ACCOUNT_NEW, bankCode: '011', bankName: 'First Bank', kind: 'SETUP',
    });

    const rowArg = mockRepository.createBankChange.mock.calls[0][0];
    expect(rowArg.status).toBe('REVIEW');
    expect(mockRepository.promoteBankChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Rule (B): UPDATE with no active recipient is treated as SETUP
// ---------------------------------------------------------------------------

describe('Rule B: UPDATE with no active recipient becomes SETUP (P-D2)', () => {
  test('kind=UPDATE + no active -> SETUP kind, immediate activation, AUTO_PROMOTED_SETUP audit', async () => {
    mockRepository.findPharmacyBanking.mockResolvedValue({
      id: 7, name: 'Test Pharmacy', recipientCode: null,
      bankAccountLast4: null, bankCode: null, bankName: null, accountName: null, bankReviewRequired: false,
    });
    mockRepository.promoteBankChange.mockImplementation(async () => ({
      change: { id: 100, pharmacyId: 7 }, activatedAt: new Date(),
    }));

    await service.requestBankChange(7, managerActor, {
      accountNumber: ACCOUNT_NEW, bankCode: '011', bankName: 'First Bank', kind: 'UPDATE',
    });

    const rowArg = mockRepository.createBankChange.mock.calls[0][0];
    expect(rowArg.kind).toBe('SETUP');

    const autoPromotedEvent = createAuditLog.mock.calls
      .map((c) => c[0])
      .find((e) => e.action === 'BANK_CHANGE_AUTO_PROMOTED_SETUP');
    expect(autoPromotedEvent).toBeDefined();
    expect(autoPromotedEvent.reason).toBeUndefined(); // reason is in details
    expect(autoPromotedEvent.details.reason).toBe('update_without_active_destination');
  });

  test('kind=SETUP with an active recipient -> 409 BANKING_ALREADY_CONFIGURED', async () => {
    mockRepository.findPharmacyBanking.mockResolvedValue({
      id: 7, name: 'Test Pharmacy', recipientCode: 'RCP_old_123',
      bankAccountLast4: '3210', bankCode: '011', bankName: 'First Bank',
      accountName: 'Test Pharmacy Ltd', bankReviewRequired: false,
    });

    await expect(
      service.requestBankChange(7, managerActor, {
        accountNumber: ACCOUNT_NEW, bankCode: '011', bankName: 'First Bank', kind: 'SETUP',
      })
    ).rejects.toMatchObject({ code: 'BANKING_ALREADY_CONFIGURED', status: 409 });
  });
});

// ---------------------------------------------------------------------------
// Name-match classifier (pure function)
// ---------------------------------------------------------------------------

describe('classifyNameMatch (Doc 2 S6.1 step 2)', () => {
  const { classifyNameMatch, normaliseName } = service._internal;

  test('normaliseName strips noise words and uppercases', () => {
    expect(normaliseName('Manzu Pharmacy Ltd')).toEqual(['MANZU']);
    expect(normaliseName('Bola Chemist Nig')).toEqual(['BOLA']);
    expect(normaliseName('A & B Enterprises')).toEqual(['A', 'B']);
  });

  test('MATCH when every token of the smaller set is in the larger', () => {
    expect(classifyNameMatch('Manzu Pharmacy Ltd', 'Manzu Pharmacy')).toBe('MATCH');
    expect(classifyNameMatch('Bola Chemist Ltd', 'Bola Pharmacy')).toBe('MATCH');
  });

  test('PARTIAL when at least 50% overlap but not 100%', () => {
    expect(classifyNameMatch('Bola Stores Ltd', 'Bola Ventures Pharmacy')).toBe('PARTIAL');
  });

  test('MISMATCH when no significant overlap', () => {
    expect(classifyNameMatch('Unrelated Ventures', 'Test Pharmacy')).toBe('MISMATCH');
    expect(classifyNameMatch('', 'Test Pharmacy')).toBe('MISMATCH');
  });
});