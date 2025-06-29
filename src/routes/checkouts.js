const express = require('express');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const prisma = new PrismaClient();

router.post('/', async (req, res) => {
  try {
    const { orderId, isPartial } = req.body.orderId ? req.body : req.query;
    const patientIdentifier = req.headers['x-guest-id'];

    if (!orderId || !patientIdentifier) {
      return res.status(400).json({ message: 'Order ID and patient identifier are required' });
    }

    const order = await prisma.order.findUnique({
      where: { id: Number(orderId), patientIdentifier },
      include: {
        items: {
          include: {
            service: true,
            prescriptions: { include: { prescription: true } },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    let totalPrice = order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    if (isPartial) {
      const nonPrescriptionItems = order.items.filter(
        item => !item.service.prescriptionRequired || item.prescriptions.length > 0
      );
      if (nonPrescriptionItems.length === 0) {
        return res.status(400).json({ message: 'No items eligible for partial checkout' });
      }
      totalPrice = nonPrescriptionItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
    }

    const checkoutSessionId = uuidv4();
    const transactionReference = `session_${checkoutSessionId}_${Date.now()}`;
    const paymentReference = `order_${orderId}_${Date.now()}`;

    // Determine order status based on prescription requirements
    const requiresPrescription = order.items.some(item => item.service.prescriptionRequired);
    const hasValidPrescription = order.items
      .filter(item => item.service.prescriptionRequired)
      .every(item => item.prescriptions.length > 0);
    const orderStatus = requiresPrescription && !hasValidPrescription ? 'pending_prescription' : 'pending';

    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: order.email || `${patientIdentifier}@example.com`,
        amount: totalPrice * 100,
        reference: transactionReference,
        callback_url: `${process.env.NEXT_PUBLIC_API_URL}/confirmation?session=${checkoutSessionId}&reference=${transactionReference}`,
        metadata: { orderId: order.id, isPartial, checkoutSessionId },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!paystackResponse.data.status) {
      console.error('Paystack error:', paystackResponse.data);
      return res.status(400).json({ message: paystackResponse.data.message || 'Failed to initialize Paystack payment' });
    }

    await prisma.transactionReference.create({
      data: {
        transactionReference,
        orderReferences: [paymentReference],
        checkoutSessionId,
        createdAt: new Date(),
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentReference,
        checkoutSessionId,
        status: orderStatus, // Set status explicitly
        updatedAt: new Date(),
      },
    });

    console.log('Checkout initiated:', { transactionReference, paymentReference, checkoutSessionId, orderId, orderStatus });

    res.status(200).json({
      message: 'Checkout initiated successfully',
      paymentUrl: paystackResponse.data.data.authorization_url,
      reference: transactionReference,
      checkoutSessionId,
    });
  } catch (error) {
    console.error('Checkout error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;