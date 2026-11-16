// tests/actor-payload.test.js
// P-03 backend: buildActorPayload returns capabilities, limits, capVersion.

process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef-OK';

const mockSettings = {
  discountCapPct: 15,
  voidWindowMinutes: 10,
  adjustThresholdUnits: 20,
  adjustApprovalUnits: 100,
  priceChangeCapPct: 30,
  refundLimitKobo: 5000000,
  bankHoldHours: 48,
  requireDeviceApproval: true, // not a limit field
  dailyDigest: true,           // not a limit field
};

jest.mock('../src/domains/pharmacy/settings/settings.service', () => ({
  getSettings: jest.fn(async () => mockSettings),
  updateSettings: jest.fn(),
}));

const { buildActorPayload, LIMIT_FIELDS } = require('../src/domains/auth/pharmacy/actor-payload');

function user(role) {
  return { id: 1, role };
}
function pharmacy() {
  return { id: 7 };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildActorPayload', () => {
  test('MANAGER returns the MANAGER capability set', async () => {
    const p = await buildActorPayload(user('MANAGER'), pharmacy());
    expect(Array.isArray(p.capabilities)).toBe(true);
    expect(p.capabilities.length).toBeGreaterThan(0);
    expect(p.capabilities).toContain('team.invite');
    expect(p.capabilities).toContain('dashboard.view');
    expect(p.capabilities).toContain('settings.edit');
  });

  test('STAFF returns the STAFF capability set', async () => {
    const p = await buildActorPayload(user('STAFF'), pharmacy());
    expect(p.capabilities).toContain('dashboard.view');
    expect(p.capabilities).not.toContain('team.invite');
    expect(p.capabilities).not.toContain('inventory.edit');
    expect(p.capabilities).not.toContain('settings.edit');
  });

  test('unknown role returns empty capabilities', async () => {
    const p = await buildActorPayload(user('OWNER'), pharmacy());
    expect(p.capabilities).toEqual([]);
  });

  test('limits contains exactly the 7 documented fields, values from settings', async () => {
    const p = await buildActorPayload(user('MANAGER'), pharmacy());
    expect(Object.keys(p.limits).sort()).toEqual([...LIMIT_FIELDS].sort());
    expect(p.limits.discountCapPct).toBe(15);
    expect(p.limits.refundLimitKobo).toBe(5000000);
    expect(p.limits.voidWindowMinutes).toBe(10);
    // Non-limit fields must not leak through
    expect(p.limits.requireDeviceApproval).toBeUndefined();
    expect(p.limits.dailyDigest).toBeUndefined();
  });

  test('capVersion is a 16-char hex string', async () => {
    const p = await buildActorPayload(user('MANAGER'), pharmacy());
    expect(p.capVersion).toMatch(/^[0-9a-f]{16}$/);
  });

  test('capVersion is stable across two identical calls', async () => {
    const a = await buildActorPayload(user('MANAGER'), pharmacy());
    const b = await buildActorPayload(user('MANAGER'), pharmacy());
    expect(a.capVersion).toBe(b.capVersion);
  });

  test('capVersion changes between MANAGER and STAFF (different capabilities)', async () => {
    const m = await buildActorPayload(user('MANAGER'), pharmacy());
    const s = await buildActorPayload(user('STAFF'), pharmacy());
    expect(m.capVersion).not.toBe(s.capVersion);
  });
});