// src/routes/auth.js
// FND-07b3: authLimiter is mounted on the login routes (not the whole router,
// so a successful login does not consume the register budget); registerLimiter
// is mounted on /register. Both come from middleware/rate-limiting.js.
//
// The catch blocks now go through sendAuthError(), which honours error.status
// (401 / 403 / 429 from the login service and the throttle), sets the
// Retry-After header when retryAfterMs is present, and emits the FND-02 error
// code when one is available.

const z = require('zod');
const express = require('express');
const pharmacyAuthService = require('../domains/auth/pharmacy/pharmacy-auth.service');
const stepupService = require('../domains/auth/pharmacy/stepup.service');
const { deviceInfoFromRequest, deviceIdFromRequest, ipFromRequest } = require('../domains/auth/pharmacy/pharmacy-session.service');
const adminAuthService = require('../domains/auth/admin/admin-auth.service');
const { registerSchema, loginSchema, addUserSchema, editUserSchema, adminLoginSchema, acceptInviteSchema } = require('../utils/adminValidation');
const { authenticatePharmacy, authorizeRoles } = require('../middleware/auth');
const { requireCapability } = require('../core/authz/require-capability');
const { publicRoute } = require('../core/authz/public-route');
const { authLimiter, registerLimiter } = require('../middleware/rate-limiting');
const router = express.Router();

/**
 * Emit an error using the FND-02 contract plus the Retry-After header when
 * the error carries a retryAfterMs. Status is error.status (fallback to
 * defaultStatus). Body includes error (code), message, requestId (only on 5xx,
 * so we do not leak ids for 4xx), and retryAfterSeconds for 429/403 lockout.
 */
function sendAuthError(res, error, requestId, defaultStatus) {
  const statusCode = Number.isInteger(error && error.status) ? error.status : defaultStatus;
  const isServerError = statusCode >= 500;

  if (error && typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0) {
    const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
  }

  const body = {
    error: (error && error.code) || (isServerError ? 'SERVER_ERROR' : 'REQUEST_ERROR'),
    message: isServerError
      ? 'Internal server error'
      : (error && error.message) || 'Request failed',
  };
  if (isServerError && requestId) body.requestId = requestId;
  if (error && typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0) {
    body.retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
  }
  return res.status(statusCode).json(body);
}

console.log('Auth routes loaded - using domain services with repository pattern');

// POST /auth/register - Register pharmacy and user
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { pharmacy, user } = registerSchema.parse(req.body);
    const { token, refreshToken, user: newUser, pharmacy: newPharmacy } = await pharmacyAuthService.registerPharmacyAndUser({ pharmacy, user, deviceInfo: deviceInfoFromRequest(req), meta: { deviceId: deviceIdFromRequest(req), ip: ipFromRequest(req) } });
    res.status(201).json({
      message: 'Registration successful',
      token,
      refreshToken,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role && newUser.role.toUpperCase() },
      pharmacy: { id: newPharmacy.id, name: newPharmacy.name },
    });
  } catch (error) {
    console.error('Registration error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Validation error', errors: error.errors });
    }
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/login - Login pharmacy user
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, pin } = loginSchema.parse(req.body);
    const { token, refreshToken, user, pharmacy } = await pharmacyAuthService.loginUser({ email, pin, deviceInfo: deviceInfoFromRequest(req), meta: { deviceId: deviceIdFromRequest(req), ip: ipFromRequest(req) } });
    res.status(200).json({
      message: 'Login successful',
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role && user.role.toUpperCase() },
      // G11: status and isActive are returned (not blocked), so the app can show a banner (PLAN D4).
      pharmacy: { id: pharmacy.id, name: pharmacy.name, status: pharmacy.status, isActive: pharmacy.isActive },
    });
  } catch (error) {
    console.error('Login error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Validation error', errors: error.errors });
    }
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/admin/login - Login admin
router.post('/admin/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = adminLoginSchema.parse(req.body);
    const { token, admin } = await adminAuthService.loginAdmin({ email, password });
    res.status(200).json({
      message: 'Admin login successful',
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role && admin.role.toUpperCase() },
    });
  } catch (error) {
    console.error('Admin login error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Validation error', errors: error.errors });
    }
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/add-user - Add new pharmacy user (manager only)
router.post('/add-user', authenticatePharmacy, authorizeRoles('MANAGER'), requireCapability('team.manage', { tier: 'T2', rate: 'team' }), async (req, res) => {
  try {
    const { name, email, pin, role } = addUserSchema.parse(req.body);
    const pharmacyId = req.user.pharmacyId;
    const user = await pharmacyAuthService.addPharmacyUser({ name, email, pin, role, pharmacyId });
    res.status(201).json({
      message: 'User added successfully',
      user: { id: user.id, name: user.name, email: user.email, role: user.role && user.role.toUpperCase() },
    });
  } catch (error) {
    console.error('Add user error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Validation error', errors: error.errors });
    }
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// PATCH /auth/users/:userId - Edit pharmacy user (manager only)
router.patch('/users/:userId', authenticatePharmacy, authorizeRoles('MANAGER'), requireCapability('team.manage', { tier: 'T2', rate: 'team' }), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid user ID' });
    }
    const { name, email, pin, role } = editUserSchema.parse(req.body);
    const managerId = req.user.userId;
    const pharmacyId = req.user.pharmacyId;
    const updatedUser = await pharmacyAuthService.editPharmacyUser(Number(userId), { name, email, pin, role }, managerId, pharmacyId);
    res.status(200).json({
      message: 'User updated successfully',
      user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role && updatedUser.role.toUpperCase() },
    });
  } catch (error) {
    console.error('Edit user error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Validation error', errors: error.errors });
    }
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// DELETE /auth/users/:userId - Delete pharmacy user (manager only)
router.delete('/users/:userId', authenticatePharmacy, authorizeRoles('MANAGER'), requireCapability('team.manage', { tier: 'T2', rate: 'team' }), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid user ID' });
    }
    const managerId = req.user.userId;
    const pharmacyId = req.user.pharmacyId;
    await pharmacyAuthService.deletePharmacyUser(Number(userId), managerId, pharmacyId);
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', { message: error.message });
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// PATCH /auth/change-password - Change pharmacy user PIN
router.patch('/change-password', authenticatePharmacy, requireCapability('self.pin.change', { tier: 'T2', rate: 'pin_change' }), async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;

    if (!currentPin || !newPin) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Current and new PIN are required' });
    }

    if (!/^\d{6}$/.test(newPin)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'New PIN must be exactly 6 digits' });
    }

    const { userId } = req.user;
    const result = await pharmacyAuthService.changePharmacyUserPin(userId, currentPin, newPin);

    if (!result.success) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: result.message });
    }

    res.status(200).json({ message: 'PIN changed successfully' });
  } catch (error) {
    console.error('Change PIN error:', { message: error.message });
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/step-up - Issue a step-up token (FND-08a)
//
// Verifies the PIN (same bcrypt cost as login and change-pin), throttles
// attempts, and returns a 5-minute step-up token bound to the current session.
// The token is used by requireStepUp(scope) on the routes that need it (Doc 2
// for banking, Doc 3 for admin actions). Nothing requires step-up yet.
//
// T3 scopes return APPROVAL_REQUIRED; FND-08 does not issue T3.
router.post('/step-up', authenticatePharmacy, async (req, res) => {
  try {
    const { pin, scope } = req.body || {};
    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'PIN is required.' });
    }
    if (!scope || typeof scope !== 'string') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Scope is required.' });
    }
    const result = await stepupService.issueStepUp({
      userId: req.user.userId,
      sessionId: req.user.sid,
      pin,
      scope,
    });
    if (!result.ok) {
      const status =
        result.code === 'RATE_LIMITED' || result.code === 'ACCOUNT_LOCKED' ? 429 :
        result.code === 'APPROVAL_REQUIRED' ? 409 :
        403;
      const err = new Error(result.message);
      err.status = status;
      err.code = result.code;
      if (result.retryAfterMs) err.retryAfterMs = result.retryAfterMs;
      return sendAuthError(res, err, req.requestId, status);
    }
    return res.status(200).json({
      message: 'Step-up granted',
      token: result.token,
      scope: result.scope,
      tier: result.tier,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    console.error('Step-up error:', { message: error.message });
    return sendAuthError(res, error, req.requestId, 500);
  }
});


// ============================================================================
// P-06: invite, suspend, reactivate, pin-reset (Doc 2 section 5.2)
// ============================================================================

// POST /auth/invite/accept - Public: invitee sets their PIN and becomes ACTIVE.
router.post('/invite/accept', authLimiter, publicRoute('invitee has no account yet; the invite code is their credential'), async (req, res) => {
  try {
    const parsed = acceptInviteSchema.parse(req.body);
    const result = await pharmacyAuthService.acceptInvite({
      email: parsed.email,
      code: parsed.code,
      pin: parsed.pin,
      deviceInfo: parsed.deviceInfo || deviceInfoFromRequest(req),
      meta: { deviceId: parsed.deviceId || deviceIdFromRequest(req), ip: ipFromRequest(req) },
    });
    res.status(200).json({
      message: 'Invite accepted',
      token: result.token,
      refreshToken: result.refreshToken,
      user: { id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role && result.user.role.toUpperCase() },
      pharmacy: { id: result.pharmacy.id, name: result.pharmacy.name, status: result.pharmacy.status, isActive: result.pharmacy.isActive },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Validation error', errors: error.errors });
    }
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/users/:userId/invite - Manager issues (or re-issues) an invite code.
router.post('/users/:userId/invite', authenticatePharmacy, authorizeRoles('MANAGER'), requireCapability('team.invite', { tier: 'T2', rate: 'team' }), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid user ID' });
    }
    const result = await pharmacyAuthService.createInvite(Number(userId), req.user.userId, req.user.pharmacyId);
    res.status(200).json({ message: 'Invite created', code: result.code, expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/users/:userId/suspend - Manager suspends an ACTIVE user.
router.post('/users/:userId/suspend', authenticatePharmacy, authorizeRoles('MANAGER'), requireCapability('team.suspend', { tier: 'T2', rate: 'team' }), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid user ID' });
    }
    await pharmacyAuthService.suspendPharmacyUser(Number(userId), req.user.userId, req.user.pharmacyId);
    res.status(200).json({ message: 'User suspended' });
  } catch (error) {
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/users/:userId/reactivate - Manager reactivates a SUSPENDED user.
router.post('/users/:userId/reactivate', authenticatePharmacy, authorizeRoles('MANAGER'), requireCapability('team.suspend', { tier: 'T2', rate: 'team' }), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid user ID' });
    }
    const result = await pharmacyAuthService.reactivatePharmacyUser(Number(userId), req.user.userId, req.user.pharmacyId);
    res.status(200).json({ message: 'User reactivation pending accept', code: result.code, expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    return sendAuthError(res, error, req.requestId, 500);
  }
});

// POST /auth/users/:userId/pin-reset - Manager resets a user's PIN.
router.post('/users/:userId/pin-reset', authenticatePharmacy, authorizeRoles('MANAGER'), requireCapability('team.pin.reset', { tier: 'T2', rate: 'team' }), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid user ID' });
    }
    const result = await pharmacyAuthService.resetPharmacyUserPin(Number(userId), req.user.userId, req.user.pharmacyId);
    res.status(200).json({ message: 'PIN reset initiated', code: result.code, expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    return sendAuthError(res, error, req.requestId, 500);
  }
});

module.exports = router;