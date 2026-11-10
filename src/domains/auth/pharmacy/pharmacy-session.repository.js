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

module.exports = {
  createRefreshToken,
  findRefreshTokenByHash,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  deleteStaleForUser,
  findUserWithPharmacy,
};
