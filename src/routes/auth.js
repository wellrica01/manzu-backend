const z = require('zod');

const express = require('express');
const authService = require('../services/authService');
const { registerSchema, loginSchema, addUserSchema, editUserSchema, adminRegisterSchema, adminLoginSchema } = require('../utils/adminValidation');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded auth.js version: 2025-06-21-v1');

// POST /auth/register - Register pharmacy and user
router.post('/register', async (req, res) => {
  try {
    const { pharmacy, user } = registerSchema.parse(req.body);
    const { token, user: newUser, pharmacy: newPharmacy } = await authService.registerPharmacyAndUser({ pharmacy, user });
    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role && newUser.role.toUpperCase() },
      pharmacy: { id: newPharmacy.id, name: newPharmacy.name },
    });
  } catch (error) {
    console.error('Registration error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// POST /auth/login - Login pharmacy user
router.post('/login', async (req, res) => {
  try {
    const { email, pin } = loginSchema.parse(req.body);
    const { token, user, pharmacy } = await authService.loginUser({ email, pin });
    res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role && user.role.toUpperCase() },
      pharmacy: { id: pharmacy.id, name: pharmacy.name },
    });
  } catch (error) {
    console.error('Login error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 401 ? 401 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});


// POST /auth/admin/register - Register admin
router.post('/admin/register', async (req, res) => {
  try {
    const { name, email, password } = adminRegisterSchema.parse(req.body);
    const { token, admin } = await authService.registerAdmin({ name, email, password });
    res.status(201).json({
      message: 'Admin registration successful',
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role && admin.role.toUpperCase() },
    });
  } catch (error) {
    console.error('Admin registration error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// POST /auth/admin/login - Login admin
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = adminLoginSchema.parse(req.body);
    const { token, admin } = await authService.loginAdmin({ email, password });
    res.status(200).json({
      message: 'Admin login successful',
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role && admin.role.toUpperCase() },
    });
  } catch (error) {
    console.error('Admin login error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 401 ? 401 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// POST /auth/add-user - Add new pharmacy user (manager only)
router.post('/add-user', authenticate, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { name, email, pin, role } = addUserSchema.parse(req.body);
    const pharmacyId = req.user.pharmacyId;
    const user = await authService.addPharmacyUser({ name, email, pin, role, pharmacyId });
    res.status(201).json({
      message: 'User added successfully',
      user: { id: user.id, name: user.name, email: user.email, role: user.role && user.role.toUpperCase() },
    });
  } catch (error) {
    console.error('Add user error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// PATCH /auth/users/:userId - Edit pharmacy user (manager only)
router.patch('/users/:userId', authenticate, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const { name, email, pin } = editUserSchema.parse(req.body);
    const managerId = req.user.userId;
    const pharmacyId = req.user.pharmacyId;
    const updatedUser = await authService.editPharmacyUser(Number(userId), { name, email, pin }, managerId, pharmacyId);
    res.status(200).json({
      message: 'User updated successfully',
      user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role && updatedUser.role.toUpperCase() },
    });
  } catch (error) {
    console.error('Edit user error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status || 500).json({ message: error.message || 'Server error', error: error.message });
  }
});


// DELETE /auth/users/:userId - Delete pharmacy user (manager only)
router.delete('/users/:userId', authenticate, authorizeRoles( 'MANAGER'), async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const managerId = req.user.userId;
    const pharmacyId = req.user.pharmacyId;
    await authService.deletePharmacyUser(Number(userId), managerId, pharmacyId);
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', { message: error.message, stack: error.stack });
    res.status(error.status || 500).json({ message: error.message || 'Server error', error: error.message });
  }
});


// PATCH /auth/change-password - Change pharmacy user password
router.patch('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new PIN are required' });
    }
    
    // Validate new PIN format
    if (!/^\d{6}$/.test(newPassword)) {
      return res.status(400).json({ message: 'New PIN must be exactly 6 digits' });
    }
    
    const { userId } = req.user;
    const result = await authService.changePharmacyUserPassword(userId, currentPassword, newPassword);
    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }
    res.status(200).json({ message: 'PIN changed successfully' });
  } catch (error) {
    console.error('Change PIN error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: error.message || 'Server error' });
  }
});


module.exports = router;