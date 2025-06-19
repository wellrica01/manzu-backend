const express = require('express');
const authService = require('../services/authService');
const { registerSchema, loginSchema, addUserSchema, editUserSchema, editProfileSchema, adminRegisterSchema, adminLoginSchema } = require('../utils/adminValidation');
const { authenticate, authenticateManager, authenticateAdmin } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded auth.js version: 2025-06-19-v1');

// POST /auth/register - Register pharmacy and user
router.post('/register', async (req, res) => {
  try {
    const { pharmacy, user } = registerSchema.parse(req.body);
    const { token, user: newUser, pharmacy: newPharmacy } = await authService.registerPharmacyAndUser({ pharmacy, user });
    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
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

// POST /auth/login - Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { token, user, pharmacy } = await authService.loginUser({ email, password });
    res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
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

// POST /auth/admin/login - Login admin
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

// POST /auth/add-user - Add new user to pharmacy (manager only)
router.post('/add-user', authenticate, authenticateManager, async (req, res) => {
  try {
    const { name, email, password, role } = addUserSchema.parse(req.body);
    const pharmacyId = req.user.pharmacyId;
    const user = await authService.addPharmacyUser({ name, email, password, role, pharmacyId });
    res.status(201).json({
      message: 'User added successfully',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Add user error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// PATCH /auth/users/:userId - Edit user (manager only)
router.patch('/users/:userId', authenticate, authenticateManager, async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const { name, email, password } = editUserSchema.parse(req.body);
    const managerId = req.user.userId;
    const pharmacyId = req.user.pharmacyId;
    const updatedUser = await authService.editPharmacyUser(Number(userId), { name, email, password }, managerId, pharmacyId);
    res.status(200).json({
      message: 'User updated successfully',
      user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role },
    });
  } catch (error) {
    console.error('Edit user error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status || 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// DELETE /auth/users/:userId - Delete user (manager only)
router.delete('/users/:userId', authenticate, authenticateManager, async (req, res) => {
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

// GET /auth/profile - Get profile details
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { userId, pharmacyId } = req.user;
    const { user, pharmacy } = await authService.getProfile(userId, pharmacyId);
    res.status(200).json({
      message: 'Profile fetched successfully',
      user,
      pharmacy,
    });
  } catch (error) {
    console.error('Fetch profile error:', { message: error.message, stack: error.stack });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// PATCH /auth/profile - Edit profile (manager only)
router.patch('/profile', authenticate, authenticateManager, async (req, res) => {
  try {
    const { user, pharmacy } = editProfileSchema.parse(req.body);
    const { userId, pharmacyId } = req.user;
    const { updatedUser, updatedPharmacy } = await authService.editProfile({ user, pharmacy }, userId, pharmacyId);
    res.status(200).json({
      message: 'Profile updated successfully',
      user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role },
      pharmacy: {
        id: updatedPharmacy.id,
        name: updatedPharmacy.name,
        address: updatedPharmacy.address,
        lga: updatedPharmacy.lga,
        state: updatedPharmacy.state,
        ward: updatedPharmacy.ward,
        phone: updatedPharmacy.phone,
        licenseNumber: updatedPharmacy.licenseNumber,
        logoUrl: updatedPharmacy.logoUrl,
      },
    });
  } catch (error) {
    console.error('Edit profile error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

module.exports = router;