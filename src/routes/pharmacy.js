const express = require('express');
   const { PrismaClient } = require('@prisma/client');
   const router = express.Router();
   const prisma = new PrismaClient();
   
   // Fetch orders for pharmacy
   router.get('/orders', async (req, res) => {
     try {
       const pharmacyId = parseInt(req.query.pharmacyId); // Temporary: use query param
       if (!pharmacyId) {
         console.error('Missing pharmacy ID');
         return res.status(400).json({ message: 'Pharmacy ID required' });
       }
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
   router.patch('/orders/:orderId', async (req, res) => {
     try {
       const { orderId } = req.params;
       const { status } = req.body;
       const pharmacyId = parseInt(req.query.pharmacyId);
       if (!orderId || !status || !pharmacyId) {
         console.error('Missing fields:', { orderId, status, pharmacyId });
         return res.status(400).json({ message: 'Order ID, status, and pharmacy ID required' });
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
       const updatedOrder = await prisma.order.update({
         where: { id: parseInt(orderId) },
         data: { status },
       });
       console.log('Order status updated:', { orderId, status: updatedOrder.status });
       res.status(200).json({ message: 'Order status updated', order: updatedOrder });
     } catch (error) {
       console.error('Order update error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Fetch pharmacy medications
   router.get('/medications', async (req, res) => {
     try {
       const pharmacyId = parseInt(req.query.pharmacyId);
       if (!pharmacyId) {
         console.error('Missing pharmacy ID');
         return res.status(400).json({ message: 'Pharmacy ID required' });
       }
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
   router.post('/medications', async (req, res) => {
     try {
       const { pharmacyId, medicationId, stock, price } = req.body;
       if (!pharmacyId || !medicationId || stock == null || price == null) {
         console.error('Missing fields:', { pharmacyId, medicationId, stock, price });
         return res.status(400).json({ message: 'Pharmacy ID, medication ID, stock, and price required' });
       }
       const parsedPharmacyId = parseInt(pharmacyId);
       const parsedMedicationId = parseInt(medicationId);
       const parsedStock = parseInt(stock);
       const parsedPrice = parseFloat(price);
       if (parsedStock < 0 || parsedPrice < 0) {
         console.error('Invalid stock or price:', { stock, price });
         return res.status(400).json({ message: 'Stock and price must be non-negative' });
       }
       const existing = await prisma.pharmacyMedication.findUnique({
         where: { pharmacyId_medicationId: { pharmacyId: parsedPharmacyId, medicationId: parsedMedicationId } },
       });
       if (existing) {
         console.error('Medication already exists:', { pharmacyId, medicationId });
         return res.status(400).json({ message: 'Medication already exists in pharmacy inventory' });
       }
       console.log('Adding medication:', { pharmacyId, medicationId, stock, price });
       const medication = await prisma.pharmacyMedication.create({
         data: {
           pharmacyId: parsedPharmacyId,
           medicationId: parsedMedicationId,
           stock: parsedStock,
           price: parsedPrice,
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
         },
       });
     } catch (error) {
       console.error('Add medication error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Update pharmacy medication
   router.patch('/medications', async (req, res) => {
     try {
       const { pharmacyId, medicationId, stock, price } = req.body;
       if (!pharmacyId || !medicationId || stock == null || price == null) {
         console.error('Missing fields:', { pharmacyId, medicationId, stock, price });
         return res.status(400).json({ message: 'Pharmacy ID, medication ID, stock, and price required' });
       }
       const parsedPharmacyId = parseInt(pharmacyId);
       const parsedMedicationId = parseInt(medicationId);
       const parsedStock = parseInt(stock);
       const parsedPrice = parseFloat(price);
       if (parsedStock < 0 || parsedPrice < 0) {
         console.error('Invalid stock or price:', { stock, price });
         return res.status(400).json({ message: 'Stock and price must be non-negative' });
       }
       const medication = await prisma.pharmacyMedication.findUnique({
         where: { pharmacyId_medicationId: { pharmacyId: parsedPharmacyId, medicationId: parsedMedicationId } },
         include: { medication: true },
       });
       if (!medication) {
         console.error('Medication not found:', { pharmacyId, medicationId });
         return res.status(404).json({ message: 'Medication not found' });
       }
       console.log('Updating medication:', { pharmacyId, medicationId, stock, price });
       const updatedMedication = await prisma.pharmacyMedication.update({
         where: { pharmacyId_medicationId: { pharmacyId: parsedPharmacyId, medicationId: parsedMedicationId } },
         data: { stock: parsedStock, price: parsedPrice },
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
         },
       });
     } catch (error) {
       console.error('Update medication error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Delete pharmacy medication
   router.delete('/medications', async (req, res) => {
     try {
       const { pharmacyId, medicationId } = req.query;
       if (!pharmacyId || !medicationId) {
         console.error('Missing fields:', { pharmacyId, medicationId });
         return res.status(400).json({ message: 'Pharmacy ID and medication ID required' });
       }
       const parsedPharmacyId = parseInt(pharmacyId);
       const parsedMedicationId = parseInt(medicationId);
       const medication = await prisma.pharmacyMedication.findUnique({
         where: { pharmacyId_medicationId: { pharmacyId: parsedPharmacyId, medicationId: parsedMedicationId } },
       });
       if (!medication) {
         console.error('Medication not found:', { pharmacyId, medicationId });
         return res.status(404).json({ message: 'Medication not found' });
       }
       console.log('Deleting medication:', { pharmacyId, medicationId });
       await prisma.pharmacyMedication.delete({
         where: { pharmacyId_medicationId: { pharmacyId: parsedPharmacyId, medicationId: parsedMedicationId } },
       });
       console.log('Medication deleted:', { pharmacyId, medicationId });
       res.status(200).json({ message: 'Medication deleted' });
     } catch (error) {
       console.error('Delete medication error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });

   module.exports = router;