const express = require('express');
   const { PrismaClient } = require('@prisma/client');
   const axios = require('axios');
   const router = express.Router();
   const prisma = new PrismaClient();
   router.get('/', async (req, res) => {
     try {
       const { reference } = req.query;
       const userId = req.headers['x-guest-id'];
       if (!reference || !userId) {
         console.error('Missing reference or userId:', { reference, userId });
         return res.status(400).json({ message: 'Reference and guest ID required' });
       }
       const order = await prisma.order.findFirst({
         where: { paymentReference: reference, patientIdentifier: userId },
         include: { items: { include: { pharmacyMedication: { include: { medication: true, pharmacy: true } } } } },
       });
       if (!order) {
         console.error('Order not found:', { reference, userId });
         const fallbackOrder = await prisma.order.findFirst({
           where: { paymentReference: reference },
           include: { items: { include: { pharmacyMedication: { include: { medication: true, pharmacy: true } } } } },
         });
         console.log('Fallback order search:', { fallbackOrder });
         return res.status(404).json({ message: 'Order not found' });
       }
       console.log('Order found:', { orderId: order.id, paymentReference: order.paymentReference, userId: order.userId, deliveryMethod: order.deliveryMethod });
       console.log('Verifying Paystack transaction:', { reference });
       const paystackResponse = await axios.get(
         `https://api.paystack.co/transaction/verify/${reference}`,
         {
           headers: {
             Authorization: `Bearer sk_test_156a9acc720bef4a5661e9fe43910564b4f868f3`, // Replace with your Paystack secret key
             'Content-Type': 'application/json',
           },
         }
       );
       if (!paystackResponse.data.status || paystackResponse.data.data.status !== 'success') {
         console.error('Payment verification failed:', paystackResponse.data);
         await prisma.order.update({
           where: { id: order.id },
           data: { paymentStatus: 'failed' },
         });
         return res.status(400).json({ message: 'Payment verification failed', status: 'failed', order });
       }
       const trackingCode = `TRK-${order.id}-${Date.now()}`;
       await prisma.order.update({
         where: { id: order.id },
         data: { 
           paymentStatus: 'completed', 
           status: 'confirmed',
           trackingCode: trackingCode,
         },
       });
       console.log('Payment verified:', { reference, orderId: order.id, trackingCode });
       res.status(200).json({
         message: 'Payment verified',
         status: 'completed',
         order: {
           id: order.id,
           totalPrice: order.totalPrice,
           patientIdentifier: order.patientIdentifier,
           address: order.address,
           deliveryMethod: order.deliveryMethod,
           trackingCode: trackingCode,
           items: order.items.map(item => ({
             id: item.id,
             medication: { name: item.pharmacyMedication.medication.name },
             pharmacy: { 
               name: item.pharmacyMedication.pharmacy.name,
               address: item.pharmacyMedication.pharmacy.address,
             },
             quantity: item.quantity,
             price: item.price,
           })),
         },
       });
     } catch (error) {
       console.error('Confirmation error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   module.exports = router;