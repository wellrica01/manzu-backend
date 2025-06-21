const express = require('express');
const pharmacyService = require('../services/pharmacyService');
const { validateFetchOrders, validateUpdateOrder, validateFetchMedications, validateAddMedication, validateUpdateMedication, validateDeleteMedication, validateFetchUsers, validateRegisterDevice } = require('../utils/validation');
const { authenticate, authenticateManager } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded pharmacy.js version: 2025-06-19-v1');

// GET /pharmacy/orders - Fetch orders for pharmacy
router.get('/orders', authenticate, async (req, res) => {
  try {
    // Validate input (no query params to validate, but ensure user context)
    const { error } = validateFetchOrders({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const orders = await pharmacyService.fetchOrders(req.user.pharmacyId);
    res.status(200).json({ message: 'Orders fetched', orders });
  } catch (error) {
    console.error('Pharmacy orders error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /pharmacy/orders/:orderId - Update order status
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

// GET /pharmacy/medications - Fetch pharmacy medications
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

// POST /pharmacy/medications - Add new pharmacy medication
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

// PATCH /pharmacy/medications - Update pharmacy medication
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

// DELETE /pharmacy/medications - Delete pharmacy medication
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

// POST /pharmacy/notifications/register - Device registration for notifications
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

module.exports = router;