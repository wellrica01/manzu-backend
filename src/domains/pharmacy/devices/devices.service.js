// src/domains/pharmacy/devices/devices.service.js
// P-13c: device management surface over the repository methods added in P-13b.
//
// The gate itself lives in middleware/auth.js (P-13b). This service is the
// write/read side the routes call. Authorization decisions live here, not in
// the routes: a caller may only see and revoke their OWN devices, and a
// manager may only approve/deny devices whose owning user is in their own
// pharmacy.
//
// Fail-closed audit: device.approved / device.denied / device.revoked are in
// the audit catalogue's FAIL_CLOSED set, so each state change and its audit
// row share one transaction. A failed audit write rolls the change back.

const prisma = require('../../../core/database/prisma');
const repo = require('../../auth/pharmacy/pharmacy-session.repository');
const sessionService = require('../../auth/pharmacy/pharmacy-session.service');
const { createAuditLog } = require('../../../utils/audit-logger');
const { ACTIONS } = require('../../../core/audit/catalogue');
const { HTTP_STATUS } = require('../../../config/constants');

const ACTOR_TYPE = 'pharmacy_user';

function notFound() {
  const e = new Error('Device not found');
  e.status = HTTP_STATUS.NOT_FOUND;
  e.code = 'NOT_FOUND';
  return e;
}
function forbidden() {
  const e = new Error('You do not have permission to do this.');
  e.status = HTTP_STATUS.FORBIDDEN;
  e.code = 'FORBIDDEN_CAPABILITY';
  return e;
}

async function listOwnDevices(userId) {
  return repo.listDevicesForUser({ actorType: ACTOR_TYPE, actorId: userId });
}

async function revokeOwnDevice({ userId, deviceRowId }) {
  return prisma.$transaction(async (tx) => {
    const device = await repo.findDeviceById({ id: deviceRowId, tx });
    if (!device || device.actorType !== ACTOR_TYPE || device.actorId !== userId) {
      throw notFound();
    }
    await repo.revokeDevice({ id: device.id, tx });
    await createAuditLog({
      action: ACTIONS.DEVICE_REVOKED,
      entityType: 'UserDevice',
      entityId: device.id,
      details: { deviceId: device.deviceId, revokedById: userId, self: true },
      tx,
    });
    // A self-service revoke does NOT sign the user out everywhere; the gate
    // denies this device on its next request (device_ok = false).
    return { deviceId: device.deviceId, revoked: true };
  });
}

async function listTeamDevices(pharmacyId) {
  // UserDevice.actorId is a plain int with no Prisma relation to PharmacyUser,
  // so this is a raw join, not a relation include.
  const rows = await prisma.$queryRaw`
    SELECT d.*, u.name AS user_name, u.role AS user_role, u.status AS user_status
    FROM "UserDevice" d
    JOIN "PharmacyUser" u ON u.id = d."actorId" AND d."actorType" = 'pharmacy_user'
    WHERE u."pharmacyId" = ${pharmacyId}::int
    ORDER BY d."lastSeenAt" DESC
  `;
  return rows.map((d) => ({
    id: String(d.id),
    deviceId: d.deviceId,
    label: d.label,
    platform: d.platform,
    trusted: d.trusted,
    revoked: d.revokedAt !== null,
    firstSeenAt: d.firstSeenAt,
    lastSeenAt: d.lastSeenAt,
    approvedAt: d.approvedAt,
    user: { name: d.user_name, role: d.user_role, status: d.user_status },
  }));
}

async function approveDevice({ pharmacyId, approverUserId, deviceRowId }) {
  return prisma.$transaction(async (tx) => {
    const row = await loadAndCheck(tx, pharmacyId, deviceRowId);
    await repo.approveDevice({ id: row.id, approvedById: approverUserId, tx });
    await createAuditLog({
      action: ACTIONS.DEVICE_APPROVED,
      entityType: 'UserDevice',
      entityId: row.id,
      details: { deviceId: row.deviceId, approvedById: approverUserId, userId: row.actorId },
      tx,
    });
    return { id: String(row.id), approved: true };
  });
}

async function denyDevice({ pharmacyId, denierUserId, deviceRowId }) {
  const result = await prisma.$transaction(async (tx) => {
    const row = await loadAndCheck(tx, pharmacyId, deviceRowId);
    await repo.denyDevice({ id: row.id, tx });
    await createAuditLog({
      action: ACTIONS.DEVICE_DENIED,
      entityType: 'UserDevice',
      entityId: row.id,
      details: { deviceId: row.deviceId, deniedById: denierUserId, userId: row.actorId },
      tx,
    });
    return row;
  });
  // Deny must be effective even when the gate is off, so sign the user out
  // everywhere. This is deliberately different from a self-service revoke.
  await sessionService.revokeAllForUser(result.actorId);
  return { id: String(result.id), denied: true };
}

// Load a device and confirm its owning user belongs to this pharmacy.
// Throws NOT_FOUND (not FORBIDDEN) when it doesn't, so a manager cannot probe
// for device ids in other pharmacies.
async function loadAndCheck(tx, pharmacyId, deviceRowId) {
  const rows = await tx.$queryRaw`
    SELECT d.id, d."deviceId", d."actorId", d."actorType"
    FROM "UserDevice" d
    JOIN "PharmacyUser" u ON u.id = d."actorId" AND d."actorType" = 'pharmacy_user'
    WHERE d.id = ${deviceRowId}::bigint AND u."pharmacyId" = ${pharmacyId}::int
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw notFound();
  return row;
}

module.exports = { listOwnDevices, revokeOwnDevice, listTeamDevices, approveDevice, denyDevice };