/**
 * PHARMACY BANKING SERVICE (P-08, Doc 2 S6.1)
 *
 * Money-path design: a bank destination change is recorded as a "BankChange"
 * row with a cooling-off window. The ACTIVE destination on "Pharmacy" is not
 * touched until the hold elapses (PENDING -> ACTIVE via promoteBankChange) and
 * the account-name check clears. During the hold, payouts keep going to the
 * OLD verified account. A hijacker gets nothing; the pharmacy loses nothing.
 *
 * First-time setup (kind='SETUP') is exempt from the hold (P-D2): there is no
 * old destination to protect and the pharmacy has already passed admin
 * verification. It activates immediately when the name check is MATCH or
 * PARTIAL. MISMATCH always goes to REVIEW, never activates.
 *
 * All audit payloads carry only last4 for the account number; the full number
 * never leaves this file, never reaches a log line, never reaches an audit row.
 * The redact.js SECRET_KEYS blacklist would drop a stray "accountNumber"
 * anyway, but we do not rely on it - we simply never pass it.
 */

const repository = require('./pharmacy-banking.repository');
const prisma = require('../../../core/database/prisma');
const axios = require('axios');
const { createAuditLog } = require('../../../utils/audit-logger');
const { runAsSystem } = require('../../../core/context/actor-context');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIT_ACTIONS = {
  // New lifecycle (P-08). Added to catalogue.js in Deliverable 6.
  BANK_CHANGE_REQUESTED: 'BANK_CHANGE_REQUESTED',
  BANK_CHANGE_CANCELLED: 'BANK_CHANGE_CANCELLED',
  BANK_CHANGE_ACTIVATED: 'BANK_CHANGE_ACTIVATED',
  BANK_CHANGE_AUTO_PROMOTED_SETUP: 'BANK_CHANGE_AUTO_PROMOTED_SETUP',
  PAYOUT_HELD: 'PAYOUT_HELD',
  // Legacy (kept for backward compatibility with pharmacy-banking-audit.test.js)
  BANKING_SETUP: 'BANKING_SETUP',
  BANKING_UPDATED: 'BANKING_UPDATED',
  BANKING_VERIFICATION_FAILED: 'BANKING_VERIFICATION_FAILED',
};

const ENTITY_TYPES = {
  PHARMACY: 'Pharmacy',
  BANK_CHANGE: 'BankChange',
};

// Doc 2 S6.1 name-normalisation word list.
const NAME_NOISE = new Set([
  'PHARMACY', 'PHARMA', 'CHEMIST', 'LTD', 'LIMITED', 'NIG', 'ENTERPRISES', 'AND',
]);

// Doc 2 S7.4 money-sensitive limits.
const VERIFY_LIMIT_PER_DAY = 5;
const UPDATE_LIMIT_PER_DAY = 3;
const VERIFY_LOCKOUT_FAILURES = 3;
const VERIFY_LOCKOUT_MINUTES = 24 * 60;

// Bank list cache (in-memory, 1h). Reduces Paystack calls from GET /banking/banks.
let bankListCache = { at: 0, banks: null };
const BANK_LIST_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers: money, names, account number validation
// ---------------------------------------------------------------------------

function assertAccountNumber(accountNumber) {
  if (typeof accountNumber !== 'string' || !/^\d{10}$/.test(accountNumber)) {
    const err = new Error('Account number must be exactly 10 digits');
    err.code = 'BANK_INVALID_ACCOUNT';
    err.status = 400;
    throw err;
  }
}

function assertBankCodeShape(bankCode) {
  if (typeof bankCode !== 'string' || !/^\d{3,10}$/.test(bankCode)) {
    const err = new Error('Bank code is not valid');
    err.code = 'BANK_UNKNOWN_CODE';
    err.status = 400;
    throw err;
  }
}

function last4(accountNumber) {
  return typeof accountNumber === 'string' ? accountNumber.slice(-4) : null;
}

/** Uppercase, strip punctuation, drop NAME_NOISE tokens, return token array. */
function normaliseName(name) {
  if (typeof name !== 'string') return [];
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !NAME_NOISE.has(t));
}

/**
 * Doc 2 S6.1 step 2. Thresholds:
 *   MATCH    - every token of the smaller set appears in the larger
 *   PARTIAL  - at least 50% overlap
 *   MISMATCH - otherwise
 * Empty tokens on either side = MISMATCH (cannot conclude anything).
 */
function classifyNameMatch(paystackName, pharmacyName) {
  const a = normaliseName(paystackName);
  const b = normaliseName(pharmacyName);
  if (a.length === 0 || b.length === 0) return 'MISMATCH';
  const small = a.length <= b.length ? a : b;
  const large = new Set(a.length <= b.length ? b : a);
  let hit = 0;
  for (const t of small) if (large.has(t)) hit += 1;
  if (hit === small.length) return 'MATCH';
  if (hit / small.length >= 0.5) return 'PARTIAL';
  return 'MISMATCH';
}

// ---------------------------------------------------------------------------
// Paystack: verify account + list banks + create recipient
// ---------------------------------------------------------------------------

async function verifyBankAccount(accountNumber, bankCode) {
  assertAccountNumber(accountNumber);
  assertBankCodeShape(bankCode);

  // bankCode must be in the current Paystack bank list - guards against
  // injection of a crafted code and against typos.
  const banks = await getNigerianBanks();
  if (!banks.some((b) => String(b.code) === String(bankCode))) {
    const err = new Error('Unknown bank code');
    err.code = 'BANK_UNKNOWN_CODE';
    err.status = 400;
    throw err;
  }

  try {
    const response = await axios.get('https://api.paystack.co/bank/resolve', {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      // params, never string interpolation: no query-injection pivot point.
      params: { account_number: accountNumber, bank_code: bankCode },
      timeout: 10000,
    });
    if (response.data && response.data.status && response.data.data) {
      return {
        success: true,
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
      };
    }
    return { success: false, error: 'Account verification failed' };
  } catch (error) {
    return {
      success: false,
      error: (error.response && error.response.data && error.response.data.message) || 'Unable to verify account',
    };
  }
}

async function getNigerianBanks() {
  const now = Date.now();
  if (bankListCache.banks && now - bankListCache.at < BANK_LIST_TTL_MS) {
    return bankListCache.banks;
  }
  try {
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      params: { currency: 'NGN' },
      timeout: 10000,
    });
    if (response.data && response.data.status && Array.isArray(response.data.data)) {
      const banks = response.data.data.map((b) => ({ name: b.name, code: b.code, slug: b.slug }));
      bankListCache = { at: now, banks };
      return banks;
    }
    return bankListCache.banks || [];
  } catch (error) {
    return bankListCache.banks || [];
  }
}

async function createTransferRecipient(name, accountNumber, bankCode) {
  try {
    const response = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    if (response.data && response.data.status && response.data.data) {
      return { success: true, recipientCode: response.data.data.recipient_code };
    }
    return { success: false, error: 'Failed to create recipient' };
  } catch (error) {
    return {
      success: false,
      error: (error.response && error.response.data && error.response.data.message) || 'Unable to create recipient',
    };
  }
}

// ---------------------------------------------------------------------------
// requestBankChange - the single entry point for setup and update
// ---------------------------------------------------------------------------

/**
 * Request a bank destination change. Returns a masked summary of the change.
 * kind: 'SETUP' (no active destination expected) or 'UPDATE'.
 *
 * Side effects:
 *   - Inserts a BankChange row.
 *   - On SETUP with nameMatch MATCH/PARTIAL, promotes to ACTIVE in the same
 *     transaction (P-D2 immediate first-time activation).
 *   - Emits BANK_CHANGE_REQUESTED always; BANKING_SETUP/BANKING_UPDATED for
 *     backward compatibility; BANK_CHANGE_ACTIVATED when promoted.
 *   - Throttled: 3 requests/day/pharmacy; verify attempts count separately.
 */
async function requestBankChange(pharmacyId, actor, { accountNumber, bankCode, bankName, kind }) {
  assertAccountNumber(accountNumber);
  if (kind !== 'SETUP' && kind !== 'UPDATE') {
    const err = new Error('kind must be SETUP or UPDATE');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }

  // Throttle before the Paystack call so a spammer cannot use us as a lookup.
  const throttleKey = `bank_update:${pharmacyId}`;
  const throttle = await repository.hitThrottle({
    key: throttleKey,
    windowMs: 24 * 60 * 60 * 1000,
    max: UPDATE_LIMIT_PER_DAY,
    lockoutMinutes: 24 * 60,
  });
  if (!throttle.allowed) {
    const err = new Error('Too many bank changes today');
    err.code = 'BANK_LOCKED';
    err.status = 429;
    err.retryAfterMs = throttle.retryAfterMs;
    throw err;
  }

  const pharmacy = await repository.findPharmacyBanking(pharmacyId);
  if (!pharmacy) {
    const err = new Error('Pharmacy not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  // Rule (B): SETUP with an active recipient is a mistake -> 409.
  if (kind === 'SETUP' && pharmacy.recipientCode) {
    const err = new Error('Banking is already configured');
    err.code = 'BANKING_ALREADY_CONFIGURED';
    err.status = 409;
    throw err;
  }

  // Rule (B nuance): UPDATE with no active recipient is treated as SETUP.
  let effectiveKind = kind;
  if (kind === 'UPDATE' && !pharmacy.recipientCode) {
    effectiveKind = 'SETUP';
  }

  // Existing open change? Refuse rather than queue; the manager must cancel first.
  const open = await repository.findOpenBankChange(pharmacyId);
  if (open) {
    const err = new Error('A bank change is already pending for this pharmacy');
    err.code = 'COOLING_OFF';
    err.status = 409;
    err.retryAfterMs = Math.max(0, new Date(open.holdUntil).getTime() - Date.now());
    throw err;
  }

  // 1) Verify with Paystack.
  const verification = await verifyBankAccount(accountNumber, bankCode);
  if (!verification.success) {
    await createAuditLog({
      action: AUDIT_ACTIONS.BANKING_VERIFICATION_FAILED,
      entityType: ENTITY_TYPES.PHARMACY,
      entityId: pharmacyId,
      pharmacyId,
      details: { accountNumberLast4: last4(accountNumber), bankCode, error: verification.error },
    });
    const err = new Error(verification.error || 'Account verification failed');
    err.code = 'BANK_INVALID_ACCOUNT';
    err.status = 400;
    throw err;
  }

  // 2) Create Paystack recipient.
  const recipient = await createTransferRecipient(pharmacy.name, accountNumber, bankCode);
  if (!recipient.success) {
    await createAuditLog({
      action: AUDIT_ACTIONS.BANKING_VERIFICATION_FAILED,
      entityType: ENTITY_TYPES.PHARMACY,
      entityId: pharmacyId,
      pharmacyId,
      details: {
        accountNumberLast4: last4(accountNumber),
        bankCode,
        accountName: verification.accountName,
        error: recipient.error,
      },
    });
    const err = new Error(recipient.error || 'Failed to create recipient');
    err.code = 'BANK_LOOKUP_FAILED';
    err.status = 400;
    throw err;
  }

  // 3) Name-match.
  const nameMatch = classifyNameMatch(verification.accountName, pharmacy.name);

  // 4) Compute holdUntil. SETUP with MATCH/PARTIAL: 0 (immediate). Anything else: bankHoldHours.
  let holdHours = 48; // safe default; PharmacySetting overrides below
  try {
    const setting = await prisma.pharmacySetting.findUnique({ where: { pharmacyId } });
    if (setting && Number.isInteger(setting.bankHoldHours) && setting.bankHoldHours > 0) {
      holdHours = setting.bankHoldHours;
    }
  } catch (_) {
    // Fall through with the default; never fail a bank change on a settings read.
  }
  const immediateActivate = effectiveKind === 'SETUP' && nameMatch !== 'MISMATCH';
  const holdUntil = immediateActivate
    ? new Date()
    : new Date(Date.now() + holdHours * 60 * 60 * 1000);

  const initialStatus = nameMatch === 'MISMATCH' ? 'REVIEW' : 'PENDING';

  // 5) Insert BankChange (+ legacy action) in one transaction.
  const result = await prisma.$transaction(async (tx) => {
    const change = await repository.createBankChange(
      {
        pharmacyId,
        requestedById: actor && actor.id != null ? Number(actor.id) : null,
        kind: effectiveKind,
        status: initialStatus,
        newBankName: bankName,
        newBankCode: bankCode,
        newAccountLast4: last4(accountNumber),
        newAccountName: verification.accountName,
        newRecipientCode: recipient.recipientCode,
        nameMatch,
        holdUntil,
      },
      tx
    );

    // Legacy audit row (BANKING_SETUP / BANKING_UPDATED) - keeps the existing
    // redaction test green and gives the old mobile builds a familiar trail.
    await createAuditLog({
      action: effectiveKind === 'SETUP' ? AUDIT_ACTIONS.BANKING_SETUP : AUDIT_ACTIONS.BANKING_UPDATED,
      entityType: ENTITY_TYPES.PHARMACY,
      entityId: pharmacyId,
      pharmacyId,
      details: {
        accountNumberLast4: last4(accountNumber),
        bankCode,
        bankName,
        accountName: verification.accountName,
        recipientCode: recipient.recipientCode,
        ...(effectiveKind === 'UPDATE' && pharmacy.recipientCode
          ? { oldRecipientCode: pharmacy.recipientCode }
          : {}),
      },
      tx,
    });

    // New lifecycle audit row.
    await createAuditLog({
      action: AUDIT_ACTIONS.BANK_CHANGE_REQUESTED,
      entityType: ENTITY_TYPES.BANK_CHANGE,
      entityId: change.id,
      pharmacyId,
      details: {
        changeId: change.id,
        kind: effectiveKind,
        status: initialStatus,
        newAccountLast4: last4(accountNumber),
        newBankName: bankName,
        nameMatch,
        holdUntil,
      },
      tx,
    });

    if (kind === 'UPDATE' && effectiveKind === 'SETUP') {
      await createAuditLog({
        action: AUDIT_ACTIONS.BANK_CHANGE_AUTO_PROMOTED_SETUP,
        entityType: ENTITY_TYPES.BANK_CHANGE,
        entityId: change.id,
        pharmacyId,
        details: { changeId: change.id, reason: 'update_without_active_destination' },
        tx,
      });
    }

    if (immediateActivate) {
      const promoted = await repository.promoteBankChange(change.id, tx);
      if (promoted) {
        await createAuditLog({
          action: AUDIT_ACTIONS.BANK_CHANGE_ACTIVATED,
          entityType: ENTITY_TYPES.BANK_CHANGE,
          entityId: change.id,
          pharmacyId,
          details: {
            changeId: change.id,
            newAccountLast4: last4(accountNumber),
            newBankName: bankName,
          },
          tx,
        });
      }
    }

    return change;
  });

  return {
    status: initialStatus,
    bankAccountLast4: result.newAccountLast4,
    bankName: result.newBankName,
    accountName: result.newAccountName,
    holdUntil: result.holdUntil,
    requiresReview: initialStatus === 'REVIEW',
  };
}

// ---------------------------------------------------------------------------
// Legacy wrappers (compat with tests and old mobile builds until P-14)
// ---------------------------------------------------------------------------

/**
 * @deprecated use requestBankChange({ kind:'SETUP' })
 */
async function setupBankAccount(pharmacyId, { accountNumber, bankCode, bankName }) {
  return requestBankChange(pharmacyId, null, { accountNumber, bankCode, bankName, kind: 'SETUP' });
}

/**
 * @deprecated use requestBankChange({ kind:'UPDATE' })
 */
async function updateBankAccount(pharmacyId, { accountNumber, bankCode, bankName }) {
  return requestBankChange(pharmacyId, null, { accountNumber, bankCode, bankName, kind: 'UPDATE' });
}

// ---------------------------------------------------------------------------
// cancelBankChange
// ---------------------------------------------------------------------------

async function cancelBankChange(pharmacyId, actor, changeId) {
  const change = await repository.findBankChangeById(changeId);
  if (!change || change.pharmacyId !== pharmacyId) {
    const err = new Error('Bank change not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const row = await repository.cancelBankChange(changeId, actor && actor.id != null ? Number(actor.id) : null, tx);
    if (!row) return null;
    await createAuditLog({
      action: AUDIT_ACTIONS.BANK_CHANGE_CANCELLED,
      entityType: ENTITY_TYPES.BANK_CHANGE,
      entityId: changeId,
      pharmacyId,
      details: { changeId, reason: 'manager_cancelled' },
      tx,
    });
    return row;
  });

  if (!cancelled) {
    const err = new Error('Bank change is not cancellable');
    err.code = 'COOLING_OFF';
    err.status = 409;
    throw err;
  }
  return cancelled;
}

// ---------------------------------------------------------------------------
// activateDueChanges - called by the cron and lazily by getEffectiveRecipient
// ---------------------------------------------------------------------------

/**
 * Promote every PENDING change whose holdUntil has passed. Idempotent; safe to
 * call from many places. Each promotion and its BANK_CHANGE_ACTIVATED event
 * run in one transaction with an explicit pharmacyId on the event (the actor
 * here is `system` and has no pharmacyId - this is what record.js's new
 * `event.pharmacyId` override is for).
 *
 * Runs under runAsSystem so audit rows carry actorType 'system'.
 */
async function activateDueChanges() {
  return runAsSystem('bank-change-activator', async () => {
    const due = await repository.findDueBankChanges();
    let promoted = 0;
    for (const change of due) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const r = await repository.promoteBankChange(change.id, tx);
          if (!r) return null;
          await createAuditLog({
            action: AUDIT_ACTIONS.BANK_CHANGE_ACTIVATED,
            entityType: ENTITY_TYPES.BANK_CHANGE,
            entityId: change.id,
            pharmacyId: change.pharmacyId,
            details: {
              changeId: change.id,
              newAccountLast4: change.newAccountLast4,
              newBankName: change.newBankName,
            },
            tx,
          });
          return r;
        });
        if (result) promoted += 1;
      } catch (err) {
        // One pharmacy's failure must not stall the others.
        console.error('activateDueChanges failed for change', change.id, err && err.message);
      }
    }
    return { promoted, scanned: due.length };
  });
}

// ---------------------------------------------------------------------------
// getEffectiveRecipient - the only function the payout paths should call
// ---------------------------------------------------------------------------

/**
 * The recipient code a payout should pay to right now.
 * Lazily activates a due change first, so correctness does not depend on the
 * cron having run. Returns:
 *   { recipientCode: string|null, bankReviewRequired: boolean, held: boolean }
 * held=true means "bank destination in REVIEW and no active destination" - the
 * caller should skip the payout and emit PAYOUT_HELD.
 */
async function getEffectiveRecipient(pharmacyId) {
  // Cheap fast path: is there a due PENDING?
  const due = await repository.findDueBankChanges();
  if (due.some((c) => c.pharmacyId === pharmacyId)) {
    await activateDueChanges();
  }
  const active = await repository.findActiveRecipient(pharmacyId);
  if (!active) {
    return { recipientCode: null, bankReviewRequired: false, held: true };
  }
  const held = !active.recipientCode && active.bankReviewRequired;
  return {
    recipientCode: active.recipientCode || null,
    bankReviewRequired: active.bankReviewRequired,
    held,
  };
}

// ---------------------------------------------------------------------------
// getBankingStatus - masked active + pending change
// ---------------------------------------------------------------------------

async function getBankingStatus(pharmacyId) {
  const pharmacy = await repository.findPharmacyBanking(pharmacyId);
  if (!pharmacy) {
    const err = new Error('Pharmacy not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const open = await repository.findOpenBankChange(pharmacyId);
  return {
    hasActiveDestination: Boolean(pharmacy.recipientCode),
    bankName: pharmacy.bankName || null,
    bankAccountLast4: pharmacy.bankAccountLast4 || null,
    accountName: pharmacy.accountName || null,
    bankReviewRequired: Boolean(pharmacy.bankReviewRequired),
    pendingChange: open
      ? {
          id: open.id,
          kind: open.kind,
          status: open.status,
          bankAccountLast4: open.newAccountLast4,
          bankName: open.newBankName,
          accountName: open.newAccountName,
          nameMatch: open.nameMatch,
          holdUntil: open.holdUntil,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Admin-only hooks (routed by Doc 3, exported here so the lifecycle is whole)
// ---------------------------------------------------------------------------

async function activateBankChangeNow(changeId, adminActor, reason) {
  const change = await repository.findBankChangeById(changeId);
  if (!change) {
    const err = new Error('Bank change not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (change.status !== 'REVIEW' && change.status !== 'PENDING') {
    const err = new Error('Bank change is not activatable');
    err.code = 'INVALID_STATE';
    err.status = 409;
    throw err;
  }
  return prisma.$transaction(async (tx) => {
    // Force status to PENDING and holdUntil to now, then promote.
    await tx.bankChange.update({
      where: { id: changeId },
      data: { status: 'PENDING', holdUntil: new Date(), clearedById: adminActor && adminActor.id },
    });
    const r = await repository.promoteBankChange(changeId, tx);
    if (!r) {
      const err = new Error('Activation race lost');
      err.code = 'INVALID_STATE';
      err.status = 409;
      throw err;
    }
    await createAuditLog({
      action: AUDIT_ACTIONS.BANK_CHANGE_ACTIVATED,
      entityType: ENTITY_TYPES.BANK_CHANGE,
      entityId: changeId,
      pharmacyId: change.pharmacyId,
      details: { changeId, reason: reason || 'admin_force_activate', clearedById: adminActor && adminActor.id },
      tx,
    });
    return r;
  });
}

async function markReview(changeId, adminActor, reason) {
  const change = await repository.findBankChangeById(changeId);
  if (!change) {
    const err = new Error('Bank change not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  return prisma.$transaction(async (tx) => {
    await tx.bankChange.update({
      where: { id: changeId },
      data: { status: 'REVIEW' },
    });
    await createAuditLog({
      action: AUDIT_ACTIONS.BANK_CHANGE_REQUESTED, // reuse the "change event" action; details carry the transition
      entityType: ENTITY_TYPES.BANK_CHANGE,
      entityId: changeId,
      pharmacyId: change.pharmacyId,
      details: { changeId, status: 'REVIEW', reason: reason || 'admin_marked_review' },
      tx,
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // new API
  requestBankChange,
  cancelBankChange,
  activateDueChanges,
  getEffectiveRecipient,
  getBankingStatus,
  verifyBankAccount,
  getNigerianBanks,
  // admin (Doc 3 will route)
  activateBankChangeNow,
  markReview,
  // legacy compat (remove in P-08 cleanup after P-14 ships)
  setupBankAccount,
  updateBankAccount,
  // for tests
    _internal: {
    classifyNameMatch,
    normaliseName,
    last4,
    resetBankCache: () => { bankListCache = { at: 0, banks: null }; },
  },
};