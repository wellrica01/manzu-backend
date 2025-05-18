const express = require('express');
   const jwt = require('jsonwebtoken');
   const { PrismaClient } = require('@prisma/client');
   const router = express.Router();
   const prisma = new PrismaClient();
   // Middleware to verify JWT
   const authenticate = (req, res, next) => {
     const authHeader = req.headers.authorization;
     if (!authHeader || !authHeader.startsWith('Bearer ')) {
       console.error('No token provided');
       return res.status(401).json({ message: 'No token provided' });
     }
     const token = authHeader.split(' ')[1];
     try {
       const decoded = jwt.verify(token, process.env.JWT_SECRET);
       req.user = decoded; // { userId, pharmacyId, role }
       console.log('Token verified:', { userId: decoded.userId, pharmacyId: decoded.pharmacyId });
       next();
     } catch (error) {
       console.error('Invalid token:', { message: error.message });
       return res.status(401).json({ message: 'Invalid token' });
     }
   };
      // Middleware to verify manager role
   const authenticateManager = (req, res, next) => {
     if (req.user.role !== 'manager') {
       console.error('Unauthorized: Not a manager', { userId: req.user.userId });
       return res.status(403).json({ message: 'Only managers can perform this action' });
     }
     next();
   };
   // Fetch orders for pharmacy
   router.get('/orders', authenticate, async (req, res) => {
     try {
       const pharmacyId = req.user.pharmacyId;
       console.log('Fetching orders for pharmacy:', { pharmacyId });
       const orders = await prisma.order.findMany({
         where: {
           items: {
             some: {
               pharmacyMedication: {
                 pharmacyId,
               },
             },
           },
           status: { not: 'cart' },
         },
         include: {
           items: {
             include: {
               pharmacyMedication: {
                 include: {
                   medication: true,
                   pharmacy: true,
                 },
               },
             },
           },
         },
       });
       console.log('Orders fetched:', { pharmacyId, orderCount: orders.length });
       res.status(200).json({
         message: 'Orders fetched',
         orders: orders.map(order => ({
           id: order.id,
           trackingCode: order.trackingCode,
           patientIdentifier: order.patientIdentifier,
           deliveryMethod: order.deliveryMethod,
           address: order.address,
           status: order.status,
           totalPrice: order.totalPrice,
           items: order.items
             .filter(item => item.pharmacyMedication.pharmacyId === pharmacyId)
             .map(item => ({
               id: item.id,
               medication: { name: item.pharmacyMedication.medication.name },
               pharmacy: {
                 name: item.pharmacyMedication.pharmacy.name,
                 address: item.pharmacyMedication.pharmacy.address,
               },
               quantity: item.quantity,
               price: item.price,
             })),
         })),
       });
     } catch (error) {
       console.error('Pharmacy orders error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Update order status
   router.patch('/orders/:orderId', authenticate, async (req, res) => {
     try {
       const { orderId } = req.params;
       const { status } = req.body;
       const pharmacyId = req.user.pharmacyId;
       if (!orderId || !status) {
         console.error('Missing fields:', { orderId, status });
         return res.status(400).json({ message: 'Order ID and status required' });
       }
       if (!['processing', 'shipped', 'delivered', 'ready_for_pickup'].includes(status)) {
         console.error('Invalid status:', { status });
         return res.status(400).json({ message: 'Invalid status' });
       }
       const order = await prisma.order.findFirst({
         where: {
           id: parseInt(orderId),
           items: {
             some: {
               pharmacyMedication: {
                 pharmacyId,
               },
             },
           },
         },
       });
    if (!order) {
      console.error('Order not found for pharmacy:', { orderId, pharmacyId });
      return res.status(404).json({ message: 'Order not found' });
    }
    console.log('Updating order status:', { orderId, status, pharmacyId });
    const updateData = { status };
    if (status === 'delivered' || status === 'ready_for_pickup') {
      updateData.filledAt = new Date();
    }
    const updatedOrder = await prisma.order.update({
      where: { id: parseInt(orderId) },
      data: updateData,
    });
    console.log('Order status updated:', { orderId, status: updatedOrder.status, filledAt: updatedOrder.filledAt });
    res.status(200).json({ message: 'Order status updated', order: updatedOrder });
  } catch (error) {
    console.error('Order update error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
   });
   // Fetch pharmacy medications
   router.get('/medications', authenticate, async (req, res) => {
     try {
       const pharmacyId = req.user.pharmacyId;
       console.log('Fetching medications for pharmacy:', { pharmacyId });
       const medications = await prisma.pharmacyMedication.findMany({
         where: { pharmacyId },
         include: { medication: true },
       });
       const allMedications = await prisma.medication.findMany();
       console.log('Medications fetched:', { pharmacyId, medicationCount: medications.length });
       res.status(200).json({
         message: 'Medications fetched',
         medications: medications.map(m => ({
           pharmacyId: m.pharmacyId,
           medicationId: m.medicationId,
           name: m.medication.name,
           stock: m.stock,
           price: m.price,
         })),
         availableMedications: allMedications.map(m => ({
           id: m.id,
           name: m.name,
         })),
       });
     } catch (error) {
       console.error('Pharmacy medications error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });

   // Add new pharmacy medication
router.post('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId, stock, price, receivedDate, expiryDate } = req.body;
    const pharmacyId = req.user.pharmacyId;
    if (!medicationId || stock == null || price == null) {
      console.error('Missing required fields:', { pharmacyId, medicationId, stock, price });
      return res.status(400).json({ message: 'Medication ID, stock, and price required' });
    }
    const parsedMedicationId = parseInt(medicationId);
    const parsedStock = parseInt(stock);
    const parsedPrice = parseFloat(price);
    let parsedReceivedDate = null;
    let parsedExpiryDate = null;
    if (receivedDate) {
      parsedReceivedDate = new Date(receivedDate);
      if (isNaN(parsedReceivedDate)) {
        console.error('Invalid receivedDate:', { receivedDate });
        return res.status(400).json({ message: 'Invalid receivedDate format' });
      }
    }
    if (expiryDate) {
      parsedExpiryDate = new Date(expiryDate);
      if (isNaN(parsedExpiryDate)) {
        console.error('Invalid expiryDate:', { expiryDate });
        return res.status(400).json({ message: 'Invalid expiryDate format' });
      }
    }
    if (parsedStock < 0 || parsedPrice < 0) {
      console.error('Invalid stock or price:', { stock, price });
      return res.status(400).json({ message: 'Stock and price must be non-negative' });
    }
    const existing = await prisma.pharmacyMedication.findUnique({
      where: { pharmacyId_medicationId: { pharmacyId, medicationId: parsedMedicationId } },
    });
    if (existing) {
      console.error('Medication already exists:', { pharmacyId, medicationId });
      return res.status(400).json({ message: 'Medication already exists in pharmacy inventory' });
    }
    console.log('Adding medication:', { pharmacyId, medicationId, stock, price, receivedDate, expiryDate });
    const medication = await prisma.pharmacyMedication.create({
      data: {
        pharmacyId,
        medicationId: parsedMedicationId,
        stock: parsedStock,
        price: parsedPrice,
        receivedDate: parsedReceivedDate,
        expiryDate: parsedExpiryDate,
      },
      include: { medication: true },
    });
    console.log('Medication added:', { pharmacyId: medication.pharmacyId, medicationId: medication.medicationId });
    res.status(201).json({
      message: 'Medication added',
      medication: {
        pharmacyId: medication.pharmacyId,
        medicationId: medication.medicationId,
        name: medication.medication.name,
        stock: medication.stock,
        price: medication.price,
        receivedDate: medication.receivedDate,
        expiryDate: medication.expiryDate,
      },
    });
  } catch (error) {
    console.error('Add medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update pharmacy medication
router.patch('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId, stock, price, receivedDate, expiryDate } = req.body;
    const pharmacyId = req.user.pharmacyId;
    if (!medicationId || stock == null || price == null) {
      console.error('Missing required fields:', { pharmacyId, medicationId, stock, price });
      return res.status(400).json({ message: 'Medication ID, stock, and price required' });
    }
    const parsedMedicationId = parseInt(medicationId);
    const parsedStock = parseInt(stock);
    const parsedPrice = parseFloat(price);
    let parsedReceivedDate = null;
    let parsedExpiryDate = null;
    if (receivedDate) {
      parsedReceivedDate = new Date(receivedDate);
      if (isNaN(parsedReceivedDate)) {
        console.error('Invalid receivedDate:', { receivedDate });
        return res.status(400).json({ message: 'Invalid receivedDate format' });
      }
    }
    if (expiryDate) {
      parsedExpiryDate = new Date(expiryDate);
      if (isNaN(parsedExpiryDate)) {
        console.error('Invalid expiryDate:', { expiryDate });
        return res.status(400).json({ message: 'Invalid expiryDate format' });
      }
    }
    if (parsedStock < 0 || parsedPrice < 0) {
      console.error('Invalid stock or price:', { stock, price });
      return res.status(400).json({ message: 'Stock and price must be non-negative' });
    }
    const medication = await prisma.pharmacyMedication.findUnique({
      where: { pharmacyId_medicationId: { pharmacyId, medicationId: parsedMedicationId } },
      include: { medication: true },
    });
    if (!medication) {
      console.error('Medication not found:', { pharmacyId, medicationId });
      return res.status(404).json({ message: 'Medication not found' });
    }
    console.log('Updating medication:', { pharmacyId, medicationId, stock, price, receivedDate, expiryDate });
    const updatedMedication = await prisma.pharmacyMedication.update({
      where: { pharmacyId_medicationId: { pharmacyId, medicationId: parsedMedicationId } },
      data: {
        stock: parsedStock,
        price: parsedPrice,
        receivedDate: parsedReceivedDate,
        expiryDate: parsedExpiryDate,
      },
      include: { medication: true },
    });
    console.log('Medication updated:', { pharmacyId: updatedMedication.pharmacyId, medicationId: updatedMedication.medicationId });
    res.status(200).json({
      message: 'Medication updated',
      medication: {
        pharmacyId: updatedMedication.pharmacyId,
        medicationId: updatedMedication.medicationId,
        name: updatedMedication.medication.name,
        stock: updatedMedication.stock,
        price: updatedMedication.price,
        receivedDate: updatedMedication.receivedDate,
        expiryDate: updatedMedication.expiryDate,
      },
    });
  } catch (error) {
    console.error('Update medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// Delete pharmacy medication
router.delete('/medications', authenticate, async (req, res) => {
    try {
    const { medicationId } = req.query;
    const pharmacyId = req.user.pharmacyId;
    if (!medicationId) {
        console.error('Missing fields:', { pharmacyId, medicationId });
        return res.status(400).json({ message: 'Medication ID required' });
    }
    const parsedMedicationId = parseInt(medicationId);
    const medication = await prisma.pharmacyMedication.findUnique({
        where: { pharmacyId_medicationId: { pharmacyId, medicationId: parsedMedicationId } },
    });
    if (!medication) {
        console.error('Medication not found:', { pharmacyId, medicationId });
        return res.status(404).json({ message: 'Medication not found' });
    }
    console.log('Deleting medication:', { pharmacyId, medicationId });
    await prisma.pharmacyMedication.delete({
        where: { pharmacyId_medicationId: { pharmacyId, medicationId: parsedMedicationId } },
    });
    console.log('Medication deleted:', { pharmacyId, medicationId });
    res.status(200).json({ message: 'Medication deleted' });
    } catch (error) {
    console.error('Delete medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
    }
});
    // Fetch pharmacy users (manager only)
router.get('/users', authenticate, authenticateManager, async (req, res) => {
    try {
    const pharmacyId = req.user.pharmacyId;
    console.log('Fetching users for pharmacy:', { pharmacyId });
    const users = await prisma.pharmacyUser.findMany({
        where: { pharmacyId },
        select: { id: true, name: true, email: true, role: true },
    });
    console.log('Users fetched:', { pharmacyId, userCount: users.length });
    res.status(200).json({
        message: 'Users fetched',
        users,
    });
    } catch (error) {
    console.error('Fetch users error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
    }
});

   module.exports = router;