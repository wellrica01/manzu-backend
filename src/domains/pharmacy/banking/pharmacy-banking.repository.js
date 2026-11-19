/**
 * PHARMACY BANKING REPOSITORY
 *
 * Database access layer for pharmacy banking operations (P-08, Doc 2 S6.1).
 *
 * Source of truth:
 *   - "Pharmacy".{bankAccountLast4, bankCode, bankName, accountName, recipientCode}
 *     holds the CURRENT ACTIVE destination (masked last4, no full number).
 *   - "BankChange" holds any PENDING or REVIEW change with its holdUntil.
 *     The ACTIVE destination on Pharmacy is not touched until a PENDING change
 *     is promoted (hold elapsed, name match clear).
 *
 * Never select "Pharmacy"."bankAccountNumber" here - it is legacy and is
 * scheduled to be dropped by a later SQL file once no code reads it (sec-03b).
 *
 * Every function accepts an optional tx so callers inside $transaction share
 * one snapshot; the (tx || prisma) pattern is the same one settings.repository
 * and pharmacy-session.repository use.
 */

const prisma = require('../../../core/database/prisma');

/**
 * The active destination plus the id/last4, safe to send to a manager.
 * Deliberately does NOT select bankAccountNumber.
 */
async function findPharmacyBanking(pharmacyId) {
  return await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: {
      id: true,
      name: true,
      bankAccountLast4: true,
      bankCode: true,
      bankName: true,
      accountName: true,
      recipientCode: true,
      bankReviewRequired: true,
    },
  });
}

/**
 * The ACTIVE destination only, or null when the pharmacy has no active
 * recipient. Used by the payout paths and getEffectiveRecipient.
 * No full account number, no PENDING change - those never pay.
 */
async function findActiveRecipient(pharmacyId, tx = null) {
  const client = tx || prisma;
  const row = await client.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: {
      id: true,
      recipientCode: true,
      bankReviewRequired: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    recipientCode: row.recipientCode || null,
    bankReviewRequired: Boolean(row.bankReviewRequired),
  };
}

/**
 * The open PENDING or REVIEW change for a pharmacy, or null.
 * There can be at most one (partial unique index BankChange_one_open_per_pharmacy).
 */
async function findOpenBankChange(pharmacyId, tx = null) {
  const client = tx || prisma;
  return await client.bankChange.findFirst({
    where: {
      pharmacyId,
      status: { in: ['PENDING', 'REVIEW'] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * A single change by id. Used for cancel and lazy activation.
 */
async function findBankChangeById(changeId, tx = null) {
  const client = tx || prisma;
  return await client.bankChange.findUnique({ where: { id: changeId } });
}

/**
 * Insert a BankChange row. Caller has already verified the Paystack recipient
 * and matched the account name. status is PENDING (or REVIEW on MISMATCH or
 * recovery interlock).
 */
async function createBankChange(data, tx = null) {
  const client = tx || prisma;
  return await client.bankChange.create({
    data: {
      pharmacyId: data.pharmacyId,
      requestedById: data.requestedById,
      kind: data.kind,                          // 'SETUP' | 'UPDATE'
      status: data.status,                      // 'PENDING' | 'REVIEW'
      newBankName: data.newBankName,
      newBankCode: data.newBankCode,
      newAccountLast4: data.newAccountLast4,
      newAccountName: data.newAccountName,
      newRecipientCode: data.newRecipientCode,
      nameMatch: data.nameMatch,                // 'MATCH' | 'PARTIAL' | 'MISMATCH'
      holdUntil: data.holdUntil,
    },
  });
}

/**
 * Cancel an open change. Sets status CANCELLED, cancelledAt, cancelledById.
 * Returns the updated row, or null if the row is no longer open (idempotent).
 */
async function cancelBankChange(changeId, cancelledById, tx = null) {
  const client = tx || prisma;
  const now = new Date();
  const res = await client.bankChange.updateMany({
    where: { id: changeId, status: { in: ['PENDING', 'REVIEW'] } },
    data: { status: 'CANCELLED', cancelledAt: now, cancelledById },
  });
  if (res.count === 0) return null;
  return await client.bankChange.findUnique({ where: { id: changeId } });
}

/**
 * Promote a PENDING change to ACTIVE and copy its destination onto Pharmacy.
 * MUST run in a single $transaction with the caller's audit event.
 * The WHERE clause on update guards against a concurrent activate (idempotent).
 */
async function promoteBankChange(changeId, tx) {
  if (!tx) throw new TypeError('promoteBankChange requires a transaction client');
  const now = new Date();
  const change = await tx.bankChange.findUnique({ where: { id: changeId } });
  if (!change) return null;
  if (change.status !== 'PENDING') return null;                // not promotable (REVIEW/CANCELLED/ACTIVE)
  if (change.holdUntil.getTime() > now.getTime()) return null; // hold not elapsed

  // Flip the change to ACTIVE first (idempotent guard: only PENDING -> ACTIVE).
  const flipped = await tx.bankChange.updateMany({
    where: { id: changeId, status: 'PENDING' },
    data: { status: 'ACTIVE', activatedAt: now },
  });
  if (flipped.count === 0) return null; // lost the race

  // Copy onto Pharmacy in the same transaction.
  await tx.pharmacy.update({
    where: { id: change.pharmacyId },
    data: {
      recipientCode: change.newRecipientCode,
      bankCode: change.newBankCode,
      bankName: change.newBankName,
      accountName: change.newAccountName,
      bankAccountLast4: change.newAccountLast4,
      bankReviewRequired: false,
    },
  });

  return { change, activatedAt: now };
}

/**
 * Mark a change as REVIEW (name MISMATCH, or a recovery interlock).
 * Does not move Pharmacy.
 */
async function markBankChangeReview(changeId, tx = null) {
  const client = tx || prisma;
  return await client.bankChange.update({
    where: { id: changeId },
    data: { status: 'REVIEW' },
  });
}

/**
 * Admin queue helper (Doc 3 A-11 will consume). Lists REVIEW changes with
 * the requesting manager, for later admin decisions.
 */
async function listReviewBankChanges(limit = 100) {
  return await prisma.bankChange.findMany({
    where: { status: 'REVIEW' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/**
 * Verify-throttle counters. Doc 1 F6 provides `throttle.hit(opts)` and
 * `throttle.reset(opts)`; there is no read-only "get" (a lockout is a deny
 * from hit() and the caller reads retryAfterMs). Kept in this repository so
 * the banking service stays a pure-service file with no direct prisma here.
 * The caller passes the key prefix so verify and update share one helper.
 */
async function hitThrottle({ key, windowMs, max, lockoutMinutes }) {
  const throttle = require('../../../core/throttle');
  return await throttle.hit({
    class: 'banking',
    key,
    windowMs,
    max,
    lockoutMinutes,
  });
}

async function resetThrottle({ key }) {
  const throttle = require('../../../core/throttle');
  return await throttle.reset({ class: 'banking', key });
}

/**
 * All changes for a pharmacy, most recent first. Used by the manager's
 * activity view (P-11) and by GET /banking/status when it returns history
 * (only the open one is returned there today, but this is here for P-11).
 */
async function listBankChangesForPharmacy(pharmacyId, { limit = 20 } = {}) {
  return await prisma.bankChange.findMany({
    where: { pharmacyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Every PENDING change whose hold has elapsed. The lazy activator in the
 * service iterates these; the nightly cron also calls the same helper so a
 * missed lazy call cannot strand a change.
 */
async function findDueBankChanges(tx = null) {
  const client = tx || prisma;
  return await client.bankChange.findMany({
    where: {
      status: 'PENDING',
      holdUntil: { lte: new Date() },
    },
    orderBy: { holdUntil: 'asc' },
    take: 100,
  });
}

/**
 * Deprecated (P-08). Kept only for the migration window so the legacy
 * `updatePharmacyBanking` call sites in tests continue to import cleanly;
 * the function is not called by the new service. Remove in P-08 status cleanup.
 */
async function updatePharmacyBanking(pharmacyId, data, tx = null) {
  const client = tx || prisma;
  return await client.pharmacy.update({
    where: { id: pharmacyId },
    data: {
      bankAccountLast4: data.accountNumber ? String(data.accountNumber).slice(-4) : undefined,
      bankCode: data.bankCode,
      bankName: data.bankName,
      accountName: data.accountName,
      recipientCode: data.recipientCode,
    },
  });
}

module.exports = {
  // existing
  findPharmacyBanking,
  updatePharmacyBanking,
  // new
  findActiveRecipient,
  findOpenBankChange,
  findBankChangeById,
  createBankChange,
  cancelBankChange,
  promoteBankChange,
  markBankChangeReview,
  listReviewBankChanges,
  listBankChangesForPharmacy,
  findDueBankChanges,
  hitThrottle,
  resetThrottle,
};