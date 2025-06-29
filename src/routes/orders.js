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

router.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-guest-id'];
    const orderId = req.query.orderId ? parseInt(req.query.orderId) : null;

    if (!userId) {
      return res.status(400).json({ message: 'Guest ID required' });
    }

    const orderData = await orderService.getOrder(userId, orderId);
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
  const patientIdentifier = req.headers['x-guest-id'];
  const { orderId } = req.body;

  try {
    console.log('Partial checkout request:', { patientIdentifier, orderId });

    if (!patientIdentifier) {
      console.log('Missing patient identifier');
      return res.status(400).json({ message: 'Patient identifier required' });
    }

    if (!orderId) {
      console.log('Missing order ID');
      return res.status(400).json({ message: 'Order ID required' });
    }

    // Fetch the specific order with explicit prescription join
    const order = await prisma.order.findUnique({
      where: {
        id: orderId,
        patientIdentifier,
        status: { in: ['cart', 'partially_completed', 'pending_prescription', 'pending'] },
      },
      include: {
        items: {
          include: {
            service: true,
            prescriptions: {
              include: {
                prescription: true,
              },
            },
            providerService: {
              include: {
                provider: true,
              },
            },
          },
        },
      },
    });

    console.log('Order fetched:', order ? {
      id: order.id,
      status: order.status,
      items: order.items.map(item => ({
        id: item.id,
        serviceId: item.serviceId,
        name: item.service.name,
        prescriptionRequired: item.service.prescriptionRequired,
        prescriptionIds: item.prescriptions.map(p => ({
          id: p.prescriptionId,
          status: p.prescription?.status || 'none',
        })),
      })),
    } : 'No order found');

    if (!order) {
      console.log('No order found for patient and orderId:', { patientIdentifier, orderId });
      return res.status(404).json({ message: 'Order not found' });
    }

    // Collect payable items for the specific order
    const payableItems = order.items
      .filter(
        (item) =>
          !item.service.prescriptionRequired ||
          item.prescriptions.some((p) => p.prescription?.status === 'verified')
      )
      .map((item) => ({ ...item, orderId: order.id }));

    console.log('Payable items found:', payableItems.map(item => ({
      id: item.id,
      orderId: item.orderId,
      serviceId: item.serviceId,
      name: item.service.name,
      prescriptionRequired: item.service.prescriptionRequired,
      prescriptionStatus: item.prescriptions.map(p => p.prescription?.status || 'none'),
      price: item.price,
      quantity: item.quantity,
    })));

    if (!payableItems.length) {
      console.log('No payable items for order:', orderId);
      return res.status(400).json({ message: 'No payable items available for partial checkout' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create new order for payable items
      const newOrder = await tx.order.create({
        data: {
          patientIdentifier,
          status: 'pending',
          totalPrice: payableItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
          paymentStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log('Created new order:', { id: newOrder.id, totalPrice: newOrder.totalPrice });

      // Move payable items to new order
      await tx.orderItem.createMany({
        data: payableItems.map((item) => ({
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

      console.log('Created order items for new order:', newOrder.id);

      // Remove payable items from the original order
      const orderPayableItemIds = payableItems.map((item) => item.id);

      if (orderPayableItemIds.length) {
        await tx.orderItem.deleteMany({
          where: {
            orderId: order.id,
            id: { in: orderPayableItemIds },
          },
        });

        await recalculateOrderTotal(order.id, tx);

        const updatedOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: true },
        });

        if (updatedOrder.items.length === 0) {
          await tx.order.delete({ where: { id: order.id } });
          console.log('Deleted empty original order:', order.id);
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'partially_completed' },
          });
          console.log('Updated original order to partially_completed:', order.id);
        }
      }

      return { newOrderId: newOrder.id };
    });

    res.status(200).json({
      message: 'Partial checkout processed successfully',
      newOrderId: result.newOrderId,
    });
  } catch (error) {
    console.error('Partial checkout error:', error.message, { patientIdentifier, orderId });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


router.post('/cancel-partial-checkout', async (req, res) => {
  try {
    const { orderId } = req.body;
    const patientIdentifier = req.headers['x-guest-id'];

    if (!orderId || isNaN(parseInt(orderId))) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }
    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier required' });
    }

    const pendingOrder = await prisma.order.findUnique({
      where: { id: Number(orderId), patientIdentifier, status: 'pending' },
      include: { items: true },
    });

    if (!pendingOrder) {
      return res.status(404).json({ message: 'Pending order not found' });
    }

    const result = await prisma.$transaction(async (tx) => {
      let cartOrder = await tx.order.findFirst({
        where: { patientIdentifier, status: 'cart' },
      });

      if (!cartOrder) {
        cartOrder = await tx.order.create({
          data: {
            patientIdentifier,
            status: 'cart',
            totalPrice: 0,
            paymentStatus: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      await tx.orderItem.createMany({
        data: pendingOrder.items.map((item) => ({
          orderId: cartOrder.id,
          providerId: item.providerId,
          serviceId: item.serviceId,
          quantity: item.quantity,
          price: item.price,
          timeSlotStart: item.timeSlotStart,
          timeSlotEnd: item.timeSlotEnd,
          fulfillmentMethod: item.fulfillmentMethod,
        })),
      });

      await tx.order.delete({ where: { id: pendingOrder.id } });

      await recalculateOrderTotal(cartOrder.id, tx);

      return { cartOrderId: cartOrder.id };
    });

    console.log('Cancelled pending order and merged to cart:', result.cartOrderId);

    res.status(200).json({
      message: 'Pending order cancelled and items merged to cart',
      cartOrderId: result.cartOrderId,
    });
  } catch (error) {
    console.error('Cancel partial checkout error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;