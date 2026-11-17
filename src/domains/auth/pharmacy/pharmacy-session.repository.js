/**
 * PHARMACY SESSION REPOSITORY
 *
 * Database access for rotating refresh tokens (PharmacyRefreshToken).
 */

const prisma = require('../../../core/database/prisma');

async function createRefreshToken({ userId, familyId, tokenHash, expiresAt, deviceInfo }) {
  return prisma.pharmacyRefreshToken.create({
    data: { userId, familyId, tokenHash, expiresAt, deviceInfo: deviceInfo || null },
  });
}

/** Finds a token row by hash, with the user (current role) and pharmacy (current status). */
async function findRefreshTokenByHash(tokenHash) {
  return prisma.pharmacyRefreshToken.findUnique({
    where: { tokenHash },
    include: { PharmacyUser: { include: { Pharmacy: true } } },
  });
}

/**
 * Atomically retires `oldRow` and stores its replacement.
 * Returns false when someone else already used or revoked `oldRow` (two refreshes racing).
 */
async function rotateRefreshToken(oldRow, { tokenHash, expiresAt, deviceInfo }) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.pharmacyRefreshToken.updateMany({
      where: { id: oldRow.id, revokedAt: null, rotatedAt: null },
      data: { revokedAt: now, rotatedAt: now },
    });
    if (claimed.count !== 1) return false;
    await tx.pharmacyRefreshToken.create({
      data: { userId: oldRow.userId, familyId: oldRow.familyId, tokenHash, expiresAt, deviceInfo: deviceInfo || oldRow.deviceInfo || null },
    });
    return true;
  });
}

async function revokeFamily(familyId) {
  return prisma.pharmacyRefreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeAllForUser(userId) {
  return prisma.pharmacyRefreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Housekeeping: drops this user's expired tokens and tokens revoked more than 7 days ago. */
async function deleteStaleForUser(userId) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return prisma.pharmacyRefreshToken.deleteMany({
    where: { userId, OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: weekAgo } }] },
  });
}

async function findUserWithPharmacy(userId) {
  return prisma.pharmacyUser.findUnique({
    where: { id: userId },
    include: { Pharmacy: true },
  });
}

/**
 * FND-09: upsert a device row for this (actorType, actorId, deviceId).
 * Best-effort: a failure must never break the login or refresh it is called
 * from - the caller wraps this in try/catch.
 *
 * On first sight: insert with firstSeenAt=now, lastSeenAt=now.
 * On repeat: update label, lastSeenAt, lastIp. The row is a stable identity.
 */
async function upsertDevice({ actorType, actorId, deviceId, label, platform, lastIp }) {
  return prisma.userDevice.upsert({
    where: { UserDevice_actor_device_key: { actorType, actorId, deviceId } },
    create: {
      actorType,
      actorId,
      deviceId,
      label: label || null,
      platform: platform || null,
      lastIp: lastIp || null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
    update: {
      label: label || null,
      platform: platform || null,
      lastIp: lastIp || null,
      lastSeenAt: new Date(),
    },
  });
}

/**
 * P-13b: the device-approval gate and its management surface.
 *
 * The gate itself (P-13b step 5) reads trusted/revokedAt through
 * loadPharmacyActor; these methods are the write side used by the
 * approve/deny routes (P-13c). findDevice is also used by the gate
 * when it needs the row for a reason other than the aggregate column.
 *
 * State mapping (matches UserDevice columns):
 *   pending   = trusted false, revokedAt null, approvedAt null
 *   approved  = trusted true,  revokedAt null, approvedAt set, approvedById set
 *   denied    = revokedAt set (deny and revoke are the same write)
 */
async function findDevice({ actorType, actorId, deviceId }) {
  return prisma.userDevice.findUnique({
    where: { UserDevice_actor_device_key: { actorType, actorId, deviceId } },
  });
}

/** All devices registered for one user, most-recently-seen first. */
async function listDevicesForUser({ actorType, actorId }) {
  return prisma.userDevice.findMany({
    where: { actorType, actorId },
    orderBy: { lastSeenAt: 'desc' },
  });
}

/** Approve a pending device. Idempotent: a second approve is a no-op update. */
async function approveDevice({ id, approvedById }) {
  return prisma.userDevice.update({
    where: { id },
    data: {
      trusted: true,
      approvedAt: new Date(),
      approvedById: approvedById || null,
      revokedAt: null,
    },
  });
}

/** Deny a pending device. Same DB write as revoke; the audit event differs. */
async function denyDevice({ id }) {
  return prisma.userDevice.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

/** Revoke an already-approved device ("sign out this device"). Same write as deny. */
async function revokeDevice({ id }) {
  return prisma.userDevice.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

/**
 * Doc 2 §5.1 (P-04): bump PharmacyUser.tokenVersion and revoke every
 * refresh-token family for this user in one transaction.
 *
 * Why both: the access token carries `tv` (tokenVersion at issue time);
 * the guard compares it to the DB value on every request. Bumping the
 * column invalidates every live access token on the next request
 * (SESSION_REVOKED). Revoking the refresh families means a role change,
 * suspension or removal cannot be refreshed into a new lease either.
 *
 * Both writes are in one $transaction: if the revoke fails, the bump is
 * rolled back too, so we never leave a bumped version with a live family.
 *
 * Returns { tokenVersion, revokedCount }.
 */
async function bumpTokenVersionAndRevoke(userId) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.pharmacyUser.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    const revoked = await tx.pharmacyRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { tokenVersion: updated.tokenVersion, revokedCount: revoked.count };
  });
}

module.exports = {
  createRefreshToken,
  findRefreshTokenByHash,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  bumpTokenVersionAndRevoke,
  deleteStaleForUser,
  findUserWithPharmacy,
  upsertDevice,
  findDevice,
  listDevicesForUser,
  approveDevice,
  denyDevice,
  revokeDevice,
};
