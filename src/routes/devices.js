// src/routes/devices.js
// P-13c: device routes.
//   GET    /api/auth/devices                        self.devices, T0
//   DELETE /api/auth/devices/:id                    self.devices, T0
//   GET    /api/pharmacy/team/devices               team.devices.manage, T0
//   POST   /api/pharmacy/team/devices/:id/approve   team.devices.manage, T2
//   POST   /api/pharmacy/team/devices/:id/deny      team.devices.manage, T2

const express = require('express');
const router = express.Router();
const { authenticatePharmacy } = require('../middleware/auth');
const { requireCapability } = require('../core/authz/require-capability');
const { sendError } = require('../core/errors/send-error');
const service = require('../domains/pharmacy/devices/devices.service');

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    const e = new Error('Invalid device id');
    e.status = 400;
    e.code = 'VALIDATION_ERROR';
    throw e;
  }
  return id;
}

// ---- Self ---------------------------------------------------------------

router.get('/auth/devices', authenticatePharmacy,
  requireCapability('self.devices', { tier: 'T0', rate: 'session' }),
  async (req, res) => {
    try {
      const devices = await service.listOwnDevices(req.user.userId);
      res.status(200).json({ devices });
    } catch (err) {
      return sendError(res, err.status || 500, err.code || 'SERVER_ERROR', err.message);
    }
  });

router.delete('/auth/devices/:id', authenticatePharmacy,
  requireCapability('self.devices', { tier: 'T0', rate: 'session' }),
  async (req, res) => {
    try {
      const id = idParam(req);
      await service.revokeOwnDevice({ userId: req.user.userId, deviceRowId: id });
      res.status(200).json({ message: 'Device signed out' });
    } catch (err) {
      return sendError(res, err.status || 500, err.code || 'SERVER_ERROR', err.message);
    }
  });

// ---- Manager ------------------------------------------------------------

router.get('/pharmacy/team/devices', authenticatePharmacy,
  requireCapability('team.devices.manage', { tier: 'T0', rate: 'read' }),
  async (req, res) => {
    try {
      const devices = await service.listTeamDevices(req.user.pharmacyId);
      res.status(200).json({ devices });
    } catch (err) {
      return sendError(res, err.status || 500, err.code || 'SERVER_ERROR', err.message);
    }
  });

router.post('/pharmacy/team/devices/:id/approve', authenticatePharmacy,
  requireCapability('team.devices.manage', { tier: 'T2', rate: 'team' }),
  async (req, res) => {
    try {
      const id = idParam(req);
      const device = await service.approveDevice({
        pharmacyId: req.user.pharmacyId,
        approverUserId: req.user.userId,
        deviceRowId: id,
      });
      res.status(200).json({ message: 'Device approved', device });
    } catch (err) {
      return sendError(res, err.status || 500, err.code || 'SERVER_ERROR', err.message);
    }
  });

router.post('/pharmacy/team/devices/:id/deny', authenticatePharmacy,
  requireCapability('team.devices.manage', { tier: 'T2', rate: 'team' }),
  async (req, res) => {
    try {
      const id = idParam(req);
      const device = await service.denyDevice({
        pharmacyId: req.user.pharmacyId,
        denierUserId: req.user.userId,
        deviceRowId: id,
      });
      res.status(200).json({ message: 'Device denied', device });
    } catch (err) {
      return sendError(res, err.status || 500, err.code || 'SERVER_ERROR', err.message);
    }
  });

module.exports = router;