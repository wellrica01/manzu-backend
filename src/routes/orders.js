const express = require('express');
const { validateAddToOrder, validateUpdateOrderItem, validateRemoveFromOrder, validateGetTimeSlots, validateUpdateOrderDetails } = require('../utils/validation');
const orderService = require('../services/orderService');
const { recalculateOrderTotal } = require('../utils/orderUtils');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();



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

    const { orderItem, order, userId: returnedUserId } = await orderService.addToOrder({
      serviceId: parseInt(serviceId),
      providerId: parseInt(providerId),
      quantity,
      userId,
      type,
    });
    res.status(201).json({ message: 'Added to order', orderItem, order, userId: returnedUserId });
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
    const { quantity, type } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateUpdateOrderItem({ orderItemId, quantity, userId, type });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const updatedItem = await orderService.updateOrderItem({ orderItemId, quantity, userId, type });
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

router.post('/partial-checkout', async (req, res) => {
  try {
    const { orderId } = req.body;
    const patientIdentifier = req.headers['x-guest-id'];

    if (!orderId || isNaN(parseInt(orderId))) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }
    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier required' });
    }

    const order = await prisma.order.findUnique({
      where: { id: Number(orderId), patientIdentifier },
      include: {
        items: {
          include: {
            service: true,
            prescriptions: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const nonPrescriptionItems = order.items.filter(
      (item) => !item.service.prescriptionRequired
    );

    if (!nonPrescriptionItems.length) {
      return res.status(400).json({ message: 'No non-prescription items available for partial checkout' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          patientIdentifier,
          status: 'pending',
          totalPrice: nonPrescriptionItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
          paymentStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await tx.orderItem.createMany({
        data: nonPrescriptionItems.map((item) => ({
          orderId: newOrder.id,
          providerId: item.providerId,
          serviceId: item.serviceId,
          quantity: item.quantity,
          price: item.price,
          timeSlotStart: item.timeSlotStart,
          timeSlotEnd: item.timeSlotEnd,
          fulfillmentMethod: item.fulfillmentMethod,
        })),
      });

      await tx.orderItem.deleteMany({
        where: {
          orderId: order.id,
          id: { in: nonPrescriptionItems.map((item) => item.id) },
        },
      });

      await recalculateOrderTotal(order.id, tx);

      const updatedOriginalOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: true },
      });

      if (updatedOriginalOrder.items.length === 0) {
        await tx.order.delete({ where: { id: order.id } });
        return { newOrderId: newOrder.id, originalOrderDeleted: true };
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'partially_completed' },
      });

      return { newOrderId: newOrder.id, originalOrderDeleted: false };
    });

    res.status(200).json({
      message: 'Partial checkout processed successfully',
      newOrderId: result.newOrderId,
      originalOrderDeleted: result.originalOrderDeleted,
    });
  } catch (error) {
    console.error('Partial checkout error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


module.exports = router;