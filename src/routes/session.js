const express = require('express');
const z = require('zod');
const { sessionLimiter } = require('../middleware/rate-limiting');
const { authenticatePharmacy } = require('../middleware/auth');
const sessionService = require('../domains/auth/pharmacy/pharmacy-session.service');
const { buildActorPayload } = require('../domains/auth/pharmacy/actor-payload');

const router = express.Router();

const refreshBodySchema = z.object({
  refreshToken: z.string().min(20).max(200),
});

function sendError(res, error, logLabel) {
  // Never log the refresh token itself.
  console.error(logLabel, { message: error.message, code: error.code });
  if (error.status === 401) {
    return res.status(401).json({ error: error.code || 'UNAUTHORIZED', message: error.message });
  }
  return res.status(500).json({
    error: 'SERVER_ERROR',
    message: 'Internal server error',
    requestId: req.requestId,
  });
}

// POST /auth/refresh - Trade a refresh token for a new access token + new refresh token (rotating)
router.post('/refresh', sessionLimiter, async (req, res) => {
  const parsed = refreshBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'refreshToken is required' });
  }
  try {
    const result = await sessionService.refreshSession(parsed.data.refreshToken, sessionService.deviceInfoFromRequest(req), {}, { deviceId: sessionService.deviceIdFromRequest(req), ip: sessionService.ipFromRequest(req) });
    const payload = await buildActorPayload(result.user, result.pharmacy);
    res.status(200).json({ message: 'Session refreshed', ...result, ...payload });
  } catch (error) {
    sendError(res, error, 'Refresh error:');
  }
});

// POST /auth/logout - Revoke this device's login chain. Always 200 (idempotent, unknown tokens ignored)
router.post('/logout', sessionLimiter, async (req, res) => {
  const parsed = refreshBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'refreshToken is required' });
  }
  try {
    await sessionService.logout(parsed.data.refreshToken);
    res.status(200).json({ message: 'Logged out' });
  } catch (error) {
    sendError(res, error, 'Logout error:');
  }
});

// GET /auth/me - Current user and pharmacy (role and status read fresh from the database)
router.get('/me', authenticatePharmacy, async (req, res) => {
  try {
    const me = await sessionService.getMe(req.user.userId);
    const payload = await buildActorPayload(me.user, me.pharmacy);
    res.status(200).json({ ...me, ...payload });
  } catch (error) {
    sendError(res, error, 'Me error:');
  }
});

module.exports = router;