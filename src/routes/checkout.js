const express = require('express');
   const { PrismaClient } = require('@prisma/client');
   const axios = require('axios');
   const router = express.Router();
   const prisma = new PrismaClient();
   router.post('/', async (req, res) => {
     try {
       const { name, email, phone, address, deliveryMethod } = req.body;
       const userId = req.headers['x-guest-id'];
       if (!userId || !name || !email || !phone || !deliveryMethod) {
         console.error('Missing fields:', { userId, name, email, phone, address, deliveryMethod });
         return res.status(400).json({ message: 'All fields are required' });
       }
       if (deliveryMethod === 'delivery' && !address) {
         console.error('Address required for delivery:', { userId });
         return res.status(400).json({ message: 'Address is required for delivery' });
       }
       const order = await prisma.order.findFirst({
         where: { patientIdentifier: userId },
         include: { items: true },
       });
       if (!order || order.items.length === 0) {
         console.error('Cart empty or not found:', { userId, order });
         return res.status(400).json({ message: 'Cart is empty' });
       }
       const amount = order.totalPrice * 100; // Paystack expects amount in kobo
       if (amount <= 0) {
         console.error('Invalid amount:', { amount, totalPrice: order.totalPrice });
         return res.status(400).json({ message: 'Invalid cart amount' });
       }
       const reference = `order_${order.id}_${Date.now()}`;
       console.log('Initiating Paystack transaction:', { email, amount, reference });
       const paystackResponse = await axios.post(
         'https://api.paystack.co/transaction/initialize',
         {
           email,
           amount,
           reference,
           callback_url: 'http://localhost:3000/confirmation',
         },
         {
           headers: {
             Authorization: `Bearer sk_test_156a9acc720bef4a5661e9fe43910564b4f868f3`, // Replace with your Paystack secret key
             'Content-Type': 'application/json',
           },
         }
       );
       if (!paystackResponse.data.status) {
         console.error('Paystack initialization failed:', paystackResponse.data);
         return res.status(500).json({ message: 'Failed to initialize payment', error: paystackResponse.data });
       }
        const updatedOrder = await prisma.order.update({
         where: { id: order.id },
         data: {
           status: 'pending',
           patientIdentifier: userId,
           address: deliveryMethod === 'delivery' ? address : null,
           paymentReference: reference,
           paymentStatus: 'pending',
           deliveryMethod,
         },
       });
        console.log('Order updated:', { orderId: updatedOrder.id, paymentReference: reference });
         res.status(200).json({
         message: 'Checkout initiated',
         paymentReference: reference,
       });
     } catch (error) {
       console.error('Checkout error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   module.exports = router;