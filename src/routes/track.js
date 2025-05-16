const express = require('express');
   const { PrismaClient } = require('@prisma/client');
   const router = express.Router();
   const prisma = new PrismaClient();
   router.get('/', async (req, res) => {
     try {
       const { trackingCode } = req.query;
       if (!trackingCode) {
         console.error('Missing tracking code');
         return res.status(400).json({ message: 'Tracking code required' });
       }
       console.log('Searching for order by tracking code:', { trackingCode });
       const order = await prisma.order.findFirst({
         where: { trackingCode },
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
       if (!order) {
         console.error('Order not found for tracking code:', { trackingCode });
         return res.status(404).json({ message: 'Order not found' });
       }
       console.log('Order found:', { orderId: order.id, trackingCode, status: order.status });
       res.status(200).json({
         message: 'Order found',
         order: {
           id: order.id,
           totalPrice: order.totalPrice,
           patientIdentifier: order.patientIdentifier,
           address: order.address,
           deliveryMethod: order.deliveryMethod,
           trackingCode: order.trackingCode,
           status: order.status,
           paymentStatus: order.paymentStatus,
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
       console.error('Track error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   module.exports = router;