const express = require('express');
     const { PrismaClient } = require('@prisma/client');
     const { v4: uuidv4 } = require('uuid');
     const router = express.Router();
     const prisma = new PrismaClient();
  router.post('/add', async (req, res) => {
  try {
    const { medicationId, pharmacyId, quantity } = req.body;
    
    // Validate the input
    if (!medicationId || !pharmacyId || !quantity || quantity < 1) {
      return res.status(400).json({ message: 'Invalid input' });
    }

    let userId = req.headers['x-guest-id'] || uuidv4();

    // Check if an order already exists for this user
    let order = await prisma.order.findFirst({
      where: { patientIdentifier: userId, status: 'cart' },
    });

    // If no order exists, create a new one
    if (!order) {
      order = await prisma.order.create({
        data: {
          patientIdentifier: userId,
          status: 'cart',
          totalPrice: 0, // Initialize with zero or calculate later
          deliveryMethod: 'unspecified',
          pharmacyId: pharmacyId, // Associate pharmacyId dynamically
        },
      });
    }

    // Check if the medication is available at the selected pharmacy with sufficient stock
    const pharmacyMedication = await prisma.pharmacyMedication.findFirst({
      where: { medicationId, pharmacyId, stock: { gte: quantity } },
    });

    if (!pharmacyMedication) {
      return res.status(400).json({ message: 'Medication not available at this pharmacy' });
    }

    // Create or update the order item
    const orderItem = await prisma.orderItem.upsert({
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

    // Recalculate the total price of the order
    const total = await prisma.orderItem.aggregate({
      _sum: { price: true },
      where: { orderId: order.id },
    });

    // Update the total price of the order
    await prisma.order.update({
      where: { id: order.id },
      data: { totalPrice: total._sum.price || 0 },
    });

    // Send the response
    res.status(201).json({ message: 'Added to cart', orderItem, userId });
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
           return res.status(200).json({ items: [], total: 0 });
         }
         const items = order.items.map(item => ({
           id: item.id,
           medication: { name: item.pharmacyMedication.medication.name },
           pharmacy: { name: item.pharmacyMedication.pharmacy.name },
           quantity: item.quantity,
           price: item.price,
         }));
         res.status(200).json({ items, total: order.total });
       } catch (error) {
         console.error('Cart get error:', error);
         res.status(500).json({ message: 'Server error', error: error.message });
       }
     });
     router.put('/update', async (req, res) => {
       try {
         const { orderItemId, quantity } = req.body;
         const userId = req.headers['x-guest-id'];
         if (!userId || !orderItemId || !quantity || quantity < 1) {
           return res.status(400).json({ message: 'Invalid input' });
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
         const updatedItem = await prisma.orderItem.update({
           where: { id: orderItemId },
           data: { quantity, price: pharmacyMedication.price },
         });
         const total = await prisma.orderItem.aggregate({
           _sum: { price: true },
           where: { orderId: order.id },
         });
         await prisma.order.update({
           where: { id: order.id },
           data: { total: total._sum.price || 0 },
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
         if (!userId || !orderItemId) {
           return res.status(400).json({ message: 'Invalid input' });
         }
         const order = await prisma.order.findFirst({
           where: { patientIdentifier: userId, status: 'cart' },
         });
         if (!order) {
           return res.status(400).json({ message: 'Cart not found' });
         }
         await prisma.orderItem.delete({
           where: { id: orderItemId, orderId: order.id },
         });
         const total = await prisma.orderItem.aggregate({
           _sum: { price: true },
           where: { orderId: order.id },
         });
         await prisma.order.update({
           where: { id: order.id },
           data: { total: total._sum.price || 0 },
         });
         res.status(200).json({ message: 'Item removed' });
       } catch (error) {
         console.error('Cart remove error:', error);
         res.status(500).json({ message: 'Server error', error: error.message });
       }
     });
     module.exports = router;