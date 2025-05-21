const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const prisma = new PrismaClient();

async function recalculateOrderTotal(prisma, orderId) {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { price: true, quantity: true, pharmacyMedicationPharmacyId: true },
  });

  // Calculate total for the entire order
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Calculate per-pharmacy subtotals (optional for frontend)
  const subtotals = items.reduce((acc, item) => {
    const pharmacyId = item.pharmacyMedicationPharmacyId;
    acc[pharmacyId] = (acc[pharmacyId] || 0) + item.price * item.quantity;
    return acc;
  }, {});

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: { totalPrice: total, updatedAt: new Date() },
  });

  return { updatedOrder, subtotals };
}

router.post('/add', async (req, res) => {
  try {
    const { medicationId, pharmacyId, quantity } = req.body;

    // Validate input
    if (!medicationId || !pharmacyId || !quantity || quantity < 1 || !Number.isInteger(medicationId) || !Number.isInteger(pharmacyId)) {
      return res.status(400).json({ message: 'Invalid input: medicationId, pharmacyId, and quantity must be valid' });
    }

    // Check if pharmacy exists
    const pharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacyId } });
    if (!pharmacy) {
      return res.status(400).json({ message: 'Pharmacy not found' });
    }

    let userId = req.headers['x-guest-id'] || uuidv4();

    // Check if an order already exists for this user
    let order = await prisma.order.findFirst({
      where: { patientIdentifier: userId, status: 'cart' },
    });

    // If no order exists, create a new one without pharmacyId
    if (!order) {
      order = await prisma.order.create({
        data: {
          patientIdentifier: userId,
          status: 'cart',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    // Check if the medication is available at the selected pharmacy with sufficient stock
    const pharmacyMedication = await prisma.pharmacyMedication.findFirst({
      where: { medicationId, pharmacyId, stock: { gte: quantity } },
    });

    if (!pharmacyMedication) {
      return res.status(400).json({ message: 'Medication not available at this pharmacy or insufficient stock' });
    }

    // Perform order item creation/update and total recalculation in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const orderItem = await tx.orderItem.upsert({
        where: {
          orderId_pharmacyMedicationPharmacyId_pharmacyMedicationMedicationId: {
            orderId: order.id,
            pharmacyMedicationPharmacyId: pharmacyId,
            pharmacyMedicationMedicationId: medicationId,
          },
        },
        update: {
          quantity: { increment: quantity },
          price: pharmacyMedication.price,
        },
        create: {
          orderId: order.id,
          pharmacyMedicationPharmacyId: pharmacyId,
          pharmacyMedicationMedicationId: medicationId,
          quantity,
          price: pharmacyMedication.price,
        },
      });

      const { updatedOrder } = await recalculateOrderTotal(tx, order.id);

      return { orderItem, order: updatedOrder };
    });

    console.log('Created/Updated OrderItem:', result.orderItem);

    res.status(201).json({ message: 'Added to cart', orderItem: result.orderItem, userId });
  } catch (error) {
    console.error('Cart add error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-guest-id'];
    if (!userId) {
      return res.status(400).json({ message: 'Guest ID required' });
    }
    const order = await prisma.order.findFirst({
      where: { patientIdentifier: userId, status: 'cart' },
      include: {
        items: {
          include: {
            pharmacyMedication: { include: { pharmacy: true, medication: true } },
          },
        },
      },
    });
    if (!order) {
      return res.status(200).json({ items: [], totalPrice: 0, pharmacies: [] });
    }
    // Group items by pharmacy
    const pharmacyGroups = order.items.reduce((acc, item) => {
      const pharmacyId = item.pharmacyMedicationPharmacyId;
      if (!acc[pharmacyId]) {
        acc[pharmacyId] = {
          pharmacy: {
            id: pharmacyId,
            name: item.pharmacyMedication.pharmacy.name,
            address: item.pharmacyMedication.pharmacy.address,
          },
          items: [],
          subtotal: 0,
        };
      }
      acc[pharmacyId].items.push({
        id: item.id,
        medication: {
          name: item.pharmacyMedication.medication.name,
          displayName: `${item.pharmacyMedication.medication.name}${item.pharmacyMedication.medication.dosage ? ` ${item.pharmacyMedication.medication.dosage}` : ''}${item.pharmacyMedication.medication.form ? ` (${item.pharmacyMedication.medication.form})` : ''}`,
          category: item.pharmacyMedication.medication.category,
          prescriptionRequired: item.pharmacyMedication.medication.prescriptionRequired,
        },
        quantity: item.quantity,
        price: item.price,
        pharmacyMedicationMedicationId: item.pharmacyMedicationMedicationId,
        pharmacyMedicationPharmacyId: item.pharmacyMedicationPharmacyId,
      });
      acc[pharmacyId].subtotal += item.quantity * item.price;
      return acc;
    }, {});
    const pharmacies = Object.values(pharmacyGroups);
    console.log('GET /api/cart response:', { pharmacies, totalPrice: order.totalPrice });
    res.status(200).json({ pharmacies, totalPrice: order.totalPrice });
  } catch (error) {
    console.error('Cart get error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/update', async (req, res) => {
  try {
    const { orderItemId, quantity } = req.body;
    const userId = req.headers['x-guest-id'];
    console.log('Update payload:', { orderItemId, quantity, userId });
    if (!userId || !orderItemId || !quantity || quantity < 1 || !Number.isInteger(orderItemId) || !Number.isInteger(quantity)) {
      return res.status(400).json({ message: 'Invalid input: orderItemId and quantity must be valid' });
    }
    const order = await prisma.order.findFirst({
      where: { patientIdentifier: userId, status: 'cart' },
    });
    if (!order) {
      return res.status(400).json({ message: 'Cart not found' });
    }
    const orderItem = await prisma.orderItem.findFirst({
      where: { id: orderItemId, orderId: order.id },
      include: { pharmacyMedication: true },
    });
    if (!orderItem) {
      return res.status(400).json({ message: 'Item not found' });
    }
    const pharmacyMedication = await prisma.pharmacyMedication.findFirst({
      where: {
        medicationId: orderItem.pharmacyMedicationMedicationId,
        pharmacyId: orderItem.pharmacyMedicationPharmacyId,
        stock: { gte: quantity },
      },
    });
    if (!pharmacyMedication) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    // Perform order item update and total recalculation in a transaction
    const updatedItem = await prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.update({
        where: { id: orderItemId },
        data: { quantity, price: pharmacyMedication.price },
      });

      await recalculateOrderTotal(tx, order.id);

      return item;
    });

    res.status(200).json({ message: 'Cart updated', orderItem: updatedItem });
  } catch (error) {
    console.error('Cart update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/remove/:id', async (req, res) => {
  try {
    const orderItemId = parseInt(req.params.id);
    const userId = req.headers['x-guest-id'];
    if (!userId || !orderItemId || !Number.isInteger(orderItemId)) {
      return res.status(400).json({ message: 'Invalid input: orderItemId must be valid' });
    }
    const order = await prisma.order.findFirst({
      where: { patientIdentifier: userId, status: 'cart' },
    });
    if (!order) {
      return res.status(400).json({ message: 'Cart not found' });
    }

    // Perform order item deletion and total recalculation in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.delete({
        where: { id: orderItemId, orderId: order.id },
      });

      await recalculateOrderTotal(tx, order.id);
    });

    res.status(200).json({ message: 'Item removed' });
  } catch (error) {
    console.error('Cart remove error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;