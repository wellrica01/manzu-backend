// tests/pharmacy-banking-repository.test.js
// P-08: bank-change lifecycle at the repository layer.
// No real DB. The repository runs against a mocked tx; the mocked tx
// enforces the WHERE clauses so the tests are behavioural, not "did it call".

const repo = require('../src/domains/pharmacy/banking/pharmacy-banking.repository');

function makeTx({ change = null, flipCount = 1, pharmacy = { id: 7 } } = {}) {
  return {
    bankChange: {
      findUnique: jest.fn().mockResolvedValue(change),
      updateMany: jest.fn().mockResolvedValue({ count: flipCount }),
      findFirst: jest.fn().mockResolvedValue(change),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    pharmacy: {
      update: jest.fn().mockResolvedValue(pharmacy),
      findUnique: jest.fn(),
    },
  };
}

function pendingChange(overrides = {}) {
  const past = new Date(Date.now() - 1000 * 60 * 60);
  const future = new Date(Date.now() + 1000 * 60 * 60);
  return {
    id: 42,
    pharmacyId: 7,
    status: 'PENDING',
    newRecipientCode: 'RCP_new',
    newBankCode: '058',
    newBankName: 'GTBank',
    newAccountName: 'Test Pharmacy Ltd',
    newAccountLast4: '7890',
    holdUntil: past,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('pharmacy-banking.repository: bank-change lifecycle', () => {
  test('promoteBankChange refuses when holdUntil is in the future', async () => {
    const tx = makeTx({ change: pendingChange({ holdUntil: new Date(Date.now() + 60_000) }) });
    const result = await repo.promoteBankChange(42, tx);
    expect(result).toBeNull();
    expect(tx.bankChange.updateMany).not.toHaveBeenCalled();
    expect(tx.pharmacy.update).not.toHaveBeenCalled();
  });

  test('promoteBankChange flips to ACTIVE and copies onto Pharmacy in one tx', async () => {
    const change = pendingChange();
    const tx = makeTx({ change });
    const result = await repo.promoteBankChange(42, tx);

    expect(result).not.toBeNull();
    expect(result.change.id).toBe(42);
    expect(tx.bankChange.updateMany).toHaveBeenCalledWith({
      where: { id: 42, status: 'PENDING' },
      data: expect.objectContaining({ status: 'ACTIVE' }),
    });
    expect(tx.pharmacy.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        recipientCode: 'RCP_new',
        bankAccountLast4: '7890',
        bankReviewRequired: false,
      }),
    });
  });

  test('promoteBankChange is idempotent: second call in the same race is a null no-op', async () => {
    const change = pendingChange();
    // Second caller loses the WHERE status='PENDING' race.
    const tx = makeTx({ change, flipCount: 0 });
    const result = await repo.promoteBankChange(42, tx);
    expect(result).toBeNull();
    expect(tx.pharmacy.update).not.toHaveBeenCalled();
  });

  test('promoteBankChange refuses a change in REVIEW', async () => {
    const tx = makeTx({ change: pendingChange({ status: 'REVIEW' }) });
    const result = await repo.promoteBankChange(42, tx);
    expect(result).toBeNull();
    expect(tx.bankChange.updateMany).not.toHaveBeenCalled();
  });

  test('cancelBankChange returns null when nothing was open', async () => {
    const tx = makeTx({ flipCount: 0 });
    const result = await repo.cancelBankChange(42, 9, tx);
    expect(result).toBeNull();
    expect(tx.bankChange.findUnique).not.toHaveBeenCalled();
  });

  test('cancelBankChange flips PENDING -> CANCELLED and returns the row', async () => {
    const change = pendingChange();
    const tx = makeTx({ change });
    const result = await repo.cancelBankChange(42, 9, tx);
    expect(result).not.toBeNull();
    expect(tx.bankChange.updateMany).toHaveBeenCalledWith({
      where: { id: 42, status: { in: ['PENDING', 'REVIEW'] } },
      data: expect.objectContaining({ status: 'CANCELLED', cancelledById: 9 }),
    });
  });

  test('promoteBankChange throws if tx is missing (fail-closed guard)', async () => {
    await expect(repo.promoteBankChange(42, null)).rejects.toThrow(/transaction client/);
  });
});