const express = require('express');
const { validateAddToOrder, validateUpdateOrder, validateRemoveFromOrder, validateGetTimeSlots, validateUpdateOrderDetails } = require('../utils/validation');
const orderService = require('../services/orderService');
const router = express.Router();


// Add item to order
router.post('/add', async (req, res) => {
  try {
    const { serviceId, providerId, quantity, type } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateAddToOrder({ serviceId, providerId, quantity, userId, type });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { orderItem, userId: returnedUserId } = await orderService.addToOrder({
      serviceId: parseInt(serviceId),
      providerId: parseInt(providerId),
      quantity,
      userId,
    });
    res.status(201).json({ message: 'Added to order', orderItem, userId: returnedUserId });
  } catch (error) {
    console.error('Order add error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get order (cart/booking)
router.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-guest-id'];
    if (!userId) {
      return res.status(400).json({ message: 'Guest ID required' });
    }

    const orderData = await orderService.getOrder(userId);
    res.status(200).json(orderData);
  } catch (error) {
    console.error('Order get error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update order item
router.patch('/update/:itemId', async (req, res) => {
  try {
    const orderItemId = parseInt(req.params.itemId);
    const { quantity } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateUpdateOrder({ orderItemId, quantity, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const updatedItem = await orderService.updateOrderItem({ orderItemId, quantity, userId });
    res.status(200).json({ message: 'Order updated', orderItem: updatedItem });
  } catch (error) {
    console.error('Order update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove item from order
router.delete('/remove/:id', async (req, res) => {
  try {
    const orderItemId = parseInt(req.params.id);
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateRemoveFromOrder({ orderItemId, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }
    await orderService.removeFromOrder({ orderItemId, userId });
    res.status(200).json({ message: 'Item removed' });
  } catch (error) {
    console.error('Order remove error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get time slots for a provider (lab-specific)
router.get('/slots', async (req, res) => {
  try {
    const { providerId, serviceId, fulfillmentType, date } = req.query;
    const userId = req.headers['x-guest-id'];

    const { error } = validateGetTimeSlots({ providerId, serviceId, fulfillmentType, date });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { timeSlots } = await orderService.getTimeSlots({ providerId: parseInt(providerId), serviceId: serviceId ? parseInt(serviceId) : undefined, fulfillmentType, date });
    res.status(200).json({ timeSlots });
  } catch (error) {
    console.error('Order slots error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update order details (scheduling for diagnostics)
router.patch('/update-details/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { timeSlotStart, fulfillmentType } = req.body;
    const userId = req.headers['x-guest-id'];

    const { error } = validateUpdateOrderDetails({ itemId, timeSlotStart, fulfillmentType, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const result = await orderService.updateOrderDetails({ itemId, timeSlotStart, fulfillmentType, userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Order update details error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;