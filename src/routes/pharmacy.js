const express = require('express');
const pharmacyService = require('../services/pharmacyService');   
const { validateFetchOrders, validateUpdateOrder, validateFetchMedications, validateAddMedication, validateUpdateMedication, validateDeleteMedication, validateFetchUsers, validateRegisterDevice } = require('../utils/validation');
const { authenticate, authenticateManager } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded pharmacy.js version: 2025-06-19-v2 (new schema)');

// GET /pharmacy/orders - Fetch orders for pharmacy (new schema)
router.get('/orders', authenticate, async (req, res) => {
  try {
    // Parse pagination params
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    // Validate input (no query params to validate, but ensure user context)
    const { error } = validateFetchOrders({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const { orders, total } = await pharmacyService.fetchOrders(req.user.pharmacyId, { page, limit });
    res.status(200).json({ message: 'Orders fetched', orders, total, page, limit });
  } catch (error) {
    console.error('Pharmacy orders error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /pharmacy/orders/:orderId - Update order status (new schema)
router.patch('/orders/:orderId', authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    // Validate input
    const { error } = validateUpdateOrder({ orderId, status });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedOrder = await pharmacyService.updateOrderStatus(Number(orderId), status, req.user.pharmacyId);
    res.status(200).json({ message: 'Order status updated', order: updatedOrder });
  } catch (error) {
    console.error('Order update error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/medications - Fetch pharmacy medications (new schema)
router.get('/medications', authenticate, async (req, res) => {
  try {
    // Validate input (no query params to validate)
    const { error } = validateFetchMedications({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await pharmacyService.fetchMedications(req.user.pharmacyId);
    res.status(200).json({ message: 'Medications fetched', ...result });
  } catch (error) {
    console.error('Pharmacy medications error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/medications - Add new pharmacy medication (new schema)
router.post('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId, stock, price, receivedDate, expiryDate } = req.body;

    // Validate input
    const { error } = validateAddMedication({ medicationId, stock, price });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const medication = await pharmacyService.addMedication({
      pharmacyId: req.user.pharmacyId,
      medicationId: Number(medicationId),
      stock: Number(stock),
      price: Number(price),
      receivedDate,
      expiryDate,
    });
    res.status(201).json({ message: 'Medication added', medication });
  } catch (error) {
    console.error('Add medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /pharmacy/medications - Update pharmacy medication (new schema)
router.patch('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId, stock, price, receivedDate, expiryDate } = req.body;

    // Validate input
    const { error } = validateUpdateMedication({ medicationId, stock, price, receivedDate, expiryDate });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedMedication = await pharmacyService.updateMedication({
      pharmacyId: req.user.pharmacyId,
      medicationId: Number(medicationId),
      stock: Number(stock),
      price: Number(price),
      receivedDate,
      expiryDate,
    });
    res.status(200).json({ message: 'Medication updated', medication: updatedMedication });
  } catch (error) {
    console.error('Update medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE /pharmacy/medications - Delete pharmacy medication (new schema)
router.delete('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId } = req.query;

    // Validate input
    const { error } = validateDeleteMedication({ medicationId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await pharmacyService.deleteMedication(req.user.pharmacyId, Number(medicationId));
    res.status(200).json({ message: 'Medication deleted' });
  } catch (error) {
    console.error('Delete medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/users - Fetch pharmacy users (manager only)
router.get('/users', authenticate, authenticateManager, async (req, res) => {
  try {
    // Validate input (no query params to validate)
    const { error } = validateFetchUsers({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const users = await pharmacyService.fetchUsers(req.user.pharmacyId);
    res.status(200).json({ message: 'Users fetched', users });
  } catch (error) {
    console.error('Fetch users error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/notifications/register - Device registration for notifications (new schema)
router.post('/notifications/register', authenticate, async (req, res) => {
  try {
    const { deviceToken } = req.body;

    // Validate input
    const { error } = validateRegisterDevice({ deviceToken });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await pharmacyService.registerDevice(req.user.pharmacyId, deviceToken);
    res.status(200).json({ message: 'Device registered for notifications' });
  } catch (error) {
    console.error('Device registration error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/profile - Get pharmacy profile details (new schema)
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { userId, pharmacyId } = req.user;
    const { user, pharmacy } = await pharmacyService.getProfile(userId, pharmacyId);
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

// PATCH /pharmacy/profile - Edit pharmacy profile (manager only, new schema)
router.patch('/profile', authenticate, authenticateManager, async (req, res) => {
  try {
    const { user, pharmacy } = require('../utils/adminValidation').editProfileSchema.parse(req.body);
    const { userId, pharmacyId } = req.user;
    const { updatedUser, updatedPharmacy } = await pharmacyService.editProfile({ user, pharmacy }, userId, pharmacyId);
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
    if (error instanceof require('zod').ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// GET /pharmacy/dashboard - Dashboard summary for pharmacy (new schema)
// Now includes PoS (walk-in) sales stats: posSalesToday, posRevenueToday
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const data = await pharmacyService.getDashboardData(req.user.pharmacyId);
    res.status(200).json({ message: 'Dashboard data fetched', ...data });
  } catch (error) {
    console.error('Dashboard error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/sales - Record a new PoS sale (new schema)
router.post('/sales', authenticate, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !Array.isArray(items) || !total || !paymentMethod) {
      return res.status(400).json({ message: 'Invalid sale data' });
    }
    const sale = await pharmacyService.recordSale({
      pharmacyId: req.user.pharmacyId,
      items,
      total,
      paymentMethod,
    });
    res.status(201).json({ message: 'Sale recorded', sale });
  } catch (error) {
    console.error('Record sale error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/sales?date=YYYY-MM-DD - Fetch sales for a day (new schema)
router.get('/sales', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    const sales = await pharmacyService.fetchSales(req.user.pharmacyId, date);
    res.status(200).json({ message: 'Sales fetched', sales });
  } catch (error) {
    console.error('Fetch sales error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;