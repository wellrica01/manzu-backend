// tests/settings.test.js
// P-06.6d: PharmacySetting service unit tests.
//
// Covers:
//   - defaults when no row exists (read-only, no DB write)
//   - row serialization (BigInt -> Number, Decimal -> Number)
//   - upsert + audit with the { value: before } / { value: after } shape
//   - range validation (priceChangeCapPct > 100, discountCapPct < 0)
//   - empty patch still upserts (updatedById is set)
//
// Mocks the repository and audit-logger; no DB, no network.

process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const mockRepo = {
  findByPharmacyId: jest.fn(),
  upsert: jest.fn(),
};
jest.mock('../src/domains/pharmacy/settings/settings.repository', () => mockRepo);

jest.mock('../src/utils/audit-logger', () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}));

const { createAuditLog } = require('../src/utils/audit-logger');
const settingsService = require('../src/domains/pharmacy/settings/settings.service');

const PHARMACY_ID = 7;
const ACTOR_ID = 1;

function dbRow(overrides = {}) {
  return {
    pharmacyId: PHARMACY_ID,
    requireDeviceApproval: true,
    staffOpeningHoursOnly: false,
    lockAfterSeconds: 60,
    discountCapPct: '0.00',
    voidWindowMinutes: 10,
    adjustThresholdUnits: 20,
    adjustApprovalUnits: 100,
    priceChangeCapPct: 30,
    refundLimitKobo: BigInt(5000000),
    bankHoldHours: 48,
    dailyDigest: true,
    updatedAt: new Date('2026-01-01'),
    updatedById: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getSettings', () => {
  test('returns defaults when no row exists (no DB write)', async () => {
    mockRepo.findByPharmacyId.mockResolvedValue(null);
    const result = await settingsService.getSettings(PHARMACY_ID);
    expect(result).toMatchObject({
      pharmacyId: PHARMACY_ID,
      requireDeviceApproval: false,
      staffOpeningHoursOnly: false,
      lockAfterSeconds: 60,
      discountCapPct: 0,
      voidWindowMinutes: 10,
      adjustThresholdUnits: 20,
      adjustApprovalUnits: 100,
      priceChangeCapPct: 30,
      refundLimitKobo: 5000000,
      bankHoldHours: 48,
      dailyDigest: true,
      updatedAt: null,
    });
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  test('serializes an existing row with BigInt and Decimal coerced to Number', async () => {
    mockRepo.findByPharmacyId.mockResolvedValue(dbRow({ discountCapPct: '15.50' }));
    const result = await settingsService.getSettings(PHARMACY_ID);
    expect(typeof result.refundLimitKobo).toBe('number');
    expect(result.refundLimitKobo).toBe(5000000);
    expect(typeof result.discountCapPct).toBe('number');
    expect(result.discountCapPct).toBe(15.5);
    // JSON.stringify must not throw
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

describe('updateSettings', () => {
  test('upserts and emits SETTINGS_UPDATED with { value } wrapper', async () => {
    mockRepo.findByPharmacyId.mockResolvedValue(null);
    mockRepo.upsert.mockResolvedValue(dbRow({ dailyDigest: false }));

    const result = await settingsService.updateSettings(PHARMACY_ID, { dailyDigest: false }, ACTOR_ID);

    expect(mockRepo.upsert).toHaveBeenCalledWith(PHARMACY_ID, { dailyDigest: false }, ACTOR_ID);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    const evt = createAuditLog.mock.calls[0][0];
    expect(evt.action).toBe('SETTINGS_UPDATED');
    expect(evt.entityType).toBe('PharmacySetting');
    expect(evt.entityId).toBe(PHARMACY_ID);
    expect(evt.before).toHaveProperty('value');
    expect(evt.after).toHaveProperty('value');
    expect(evt.after.value.dailyDigest).toBe(false);
    expect(result.dailyDigest).toBe(false);
  });

  test('rejects priceChangeCapPct over 100 with VALIDATION_ERROR', async () => {
    const err = await settingsService.updateSettings(PHARMACY_ID, { priceChangeCapPct: 200 }, ACTOR_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  test('rejects discountCapPct below 0 with VALIDATION_ERROR', async () => {
    const err = await settingsService.updateSettings(PHARMACY_ID, { discountCapPct: -1 }, ACTOR_ID).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  test('empty patch still upserts (updatedById is set)', async () => {
    mockRepo.findByPharmacyId.mockResolvedValue(null);
    mockRepo.upsert.mockResolvedValue(dbRow());
    await settingsService.updateSettings(PHARMACY_ID, {}, ACTOR_ID);
    expect(mockRepo.upsert).toHaveBeenCalledWith(PHARMACY_ID, {}, ACTOR_ID);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });
});
