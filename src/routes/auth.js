const express = require('express');
const z = require('zod');
const authService = require('../services/prescription/authService');
const { registerSchema, loginSchema, editUserSchema, addUserSchema, editProfileSchema, adminRegisterSchema, adminLoginSchema } = require('../utils/adminValidation');
const { authenticate, authenticateManager, authenticateAdmin } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded auth.js version: 2025-06-30-v2');

// POST /api/auth/provider/register - Register provider and user
router.post('/provider/register', async (req, res) => {
  try {
    const { provider, user } = await registerSchema.parse(req.body);
    const { token, accessToken: newUser, provider: newProvider } = await authService.registerProviderAndUser({ provider, user });
    res.status(201).json({
      Status: 'Provider registration successful',
      message: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
      provider: { id: newProvider.id, name: newProvider.name },
      token,
    });
  } catch (error) {
    console.error('Provider registration error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// POST /api/auth/provider/login - Login provider user
router.post('/provider/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { token, user, provider } = await authService.loginProviderUser({ email, password });
    res.status(200).json({
      message: 'Provider login successful',
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      provider: { id: provider.id, name: provider.name },
    });
  } catch (error) {
    console.error('Provider login error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 401 ? 401 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// POST /api/auth/admin/register - Register admin
router.post('/admin/register', async (req, res) => {
  try {
    const { name, email, password } = adminRegisterSchema.parse(req.body);
    const { token, admin } = await authService.registerAdmin({ name, email, password });
    res.status(201).json({
      message: 'Admin registration successful',
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    });
  } catch (error) {
    console.error('Admin registration error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// POST /api/auth/admin/login - Login admin
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = adminLoginSchema.parse(req.body);
    const { token, admin } = await authService.loginAdmin({ email, password });
    res.status(200).json({
      message: 'Admin login successful',
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  } catch (error) {
    console.error('Admin login error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 401 ? 401 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// POST /api/auth/provider/add-user - Add new provider user (manager only)
router.post('/provider/add-user', authenticate, authenticateManager, async (req, res) => {
  try {
    const { name, email, password, role } = addUserSchema.parse(req.body);
    const providerId = req.user.providerId;
    const user = await authService.addProviderUser({ name, email, password, role, providerId });
    res.status(201).json({
      message: 'Provider user added successfully',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Add provider user error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// PATCH /api/auth/provider/users/:userId - Edit provider user (manager only)
router.patch('/provider/users/:userId', authenticate, authenticateManager, async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const { name, email, password } = editUserSchema.parse(req.body);
    const managerId = req.user.userId;
    const providerId = req.user.providerId;
    const updatedUser = await authService.editProviderUser(Number(userId), { name, email, password }, managerId, providerId);
    res.status(200).json({
      message: 'Provider user updated successfully',
      user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role },
    });
  } catch (error) {
    console.error('Edit provider user error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status || 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// DELETE /api/auth/provider/users/:userId - Delete provider user (manager only)
router.delete('/provider/users/:userId', authenticate, authenticateManager, async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const managerId = req.user.userId;
    const providerId = req.user.providerId;
    await authService.deleteProviderUser(Number(userId), managerId, providerId);
    res.status(200).json({ message: 'Provider user deleted successfully' });
  } catch (error) {
    console.error('Delete provider user error:', { message: error.message, stack: error.stack });
    res.status(error.status || 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// GET /api/auth/provider/profile - Get provider profile details
router.get('/provider/profile', authenticate, async (req, res) => {
  try {
    const { userId, providerId } = req.user;
    const { user, provider } = await authService.getProviderProfile(userId, providerId);
    res.status(200).json({
      message: 'Provider profile fetched successfully',
      user,
      provider,
    });
  } catch (error) {
    console.error('Fetch provider profile error:', { message: error.message, stack: error.stack });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// PATCH /api/auth/provider/profile - Edit provider profile (manager only)
router.patch('/provider/profile', authenticate, authenticateManager, async (req, res) => {
  try {
    const { user, provider } = editProfileSchema.parse(req.body);
    const { userId, providerId } = req.user;
    const { updatedUser, updatedProvider } = await authService.editProviderProfile({ user, provider }, userId, providerId);
    res.status(200).json({
      message: 'Provider profile updated successfully',
      user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role },
      provider: {
        id: updatedProvider.id,
        name: updatedProvider.name,
        address: updatedProvider.address,
        lga: updatedProvider.lga,
        state: updatedProvider.state,
        ward: updatedProvider.ward,
        phone: updatedProvider.phone,
        licenseNumber: updatedProvider.licenseNumber,
        logoUrl: updatedProvider.logoUrl,
        homeCollectionAvailable: updatedProvider.homeCollectionAvailable,
      },
    });
  } catch (error) {
    console.error('Edit provider profile error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

module.exports = router;