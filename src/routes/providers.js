const express = require('express');
const providerService = require('../services/providerService');
const { validateFetchOrders, validateUpdateOrder, validateFetchServices, validateAddService, validateUpdateService, validateDeleteService, validateFetchUsers, validateRegisterDevice } = require('../utils/validation');
const { authenticate, authenticateManager } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded providers.js version: 2025-06-25-v1');

// GET /providers/orders - Fetch orders for provider
router.get('/orders', authenticate, async (req, res) => {
  try {
    const { error } = validateFetchOrders({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const orders = await providerService.fetchOrders(req.user.providerId);
    res.status(200).json({ message: 'Orders fetched', orders });
  } catch (error) {
    console.error('Provider orders error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /providers/orders/:orderId - Update order status
router.patch('/orders/:orderId', authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const { error } = validateUpdateOrder({ orderId, status });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedOrder = await providerService.updateOrderStatus(Number(orderId), status, req.user.providerId);
    res.status(200).json({ message: 'Order status updated', order: updatedOrder });
  } catch (error) {
    console.error('Order update error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /providers/services - Fetch provider services
router.get('/services', authenticate, async (req, res) => {
  try {
    const { error } = validateFetchServices({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await providerService.fetchServices(req.user.providerId);
    res.status(200).json({ message: 'Services fetched', ...result });
  } catch (error) {
    console.error('Provider services error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /providers/services - Add new provider service
router.post('/services', authenticate, async (req, res) => {
  try {
    const { serviceId, stock, price, available, receivedDate, expiryDate } = req.body;

    const { error } = validateAddService({ serviceId, stock, price, available });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const service = await providerService.addService({
      providerId: req.user.providerId,
      serviceId: Number(serviceId),
      stock: Number(stock) || null,
      price: Number(price),
      available: Boolean(available),
      receivedDate,
      expiryDate,
    });
    res.status(201).json({ message: 'Service added', service });
  } catch (error) {
    console.error('Add service error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /providers/services - Update provider service
router.patch('/services', authenticate, async (req, res) => {
  try {
    const { serviceId, stock, price, available, receivedDate, expiryDate } = req.body;

    const { error } = validateUpdateService({ serviceId, stock, price, available, receivedDate, expiryDate });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedService = await providerService.updateService({
      providerId: req.user.providerId,
      serviceId: Number(serviceId),
      stock: Number(stock) || null,
      price: Number(price),
      available: Boolean(available),
      receivedDate,
      expiryDate,
    });
    res.status(200).json({ message: 'Service updated', service: updatedService });
  } catch (error) {
    console.error('Update service error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE /providers/services - Delete provider service
router.delete('/services', authenticate, async (req, res) => {
  try {
    const { serviceId } = req.query;

    const { error } = validateDeleteService({ serviceId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await providerService.deleteService(req.user.providerId, Number(serviceId));
    res.status(200).json({ message: 'Service deleted' });
  } catch (error) {
    console.error('Delete service error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /providers/users - Fetch provider users (manager only)
router.get('/users', authenticate, authenticateManager, async (req, res) => {
  try {
    const { error } = validateFetchUsers({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const users = await providerService.fetchUsers(req.user.providerId);
    res.status(200).json({ message: 'Users fetched', users });
  } catch (error) {
    console.error('Fetch users error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /providers/notifications/register - Device registration for notifications
router.post('/notifications/register', authenticate, async (req, res) => {
  try {
    const { deviceToken } = req.body;

    const { error } = validateRegisterDevice({ deviceToken });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await providerService.registerDevice(req.user.providerId, deviceToken);
    res.status(200).json({ message: 'Device registered for notifications' });
  } catch (error) {
    console.error('Device registration error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;