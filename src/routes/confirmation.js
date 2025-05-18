const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const router = express.Router();
const prisma = new PrismaClient();

// Validate reference format (basic check for Paystack reference)
const isValidReference = (reference) => typeof reference === 'string' && reference.startsWith('order_') && reference.length > 10;

router.get('/', async (req, res) => {
  try {
    const { reference } = req.query;
    const userId = req.headers['x-guest-id'];

    // Validate input
    if (!reference || !userId) {
      console.error('Missing reference or userId:', { reference, userId });
      return res.status(400).json({ message: 'Reference and guest ID required' });
    }

    if (!isValidReference(reference)) {
      console.error('Invalid reference format:', { reference });
      return res.status(400).json({ message: 'Invalid payment reference format' });
    }

    // Find order
    const order = await prisma.order.findFirst({
      where: { paymentReference: reference, patientIdentifier: userId },
      include: {
        items: {
          include: {
            pharmacyMedication: {
              include: { medication: true, pharmacy: true },
            },
          },
        },
        prescription: true,
      },
    });

    if (!order) {
      console.error('Order not found:', { reference, userId });
      return res.status(404).json({ message: 'Order not found' });
    }

    console.log('Order found:', {
      orderId: order.id,
      paymentReference: order.paymentReference,
      userId: order.patientIdentifier,
      deliveryMethod: order.deliveryMethod,
      status: order.status,
    });

    // Verify Paystack transaction
    console.log('Verifying Paystack transaction:', { reference });
    const paystackResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!paystackResponse.data.status || paystackResponse.data.data.status !== 'success') {
      console.error('Payment verification failed:', paystackResponse.data);
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'failed', updatedAt: new Date() },
        });
      });
      return res.status(400).json({ message: 'Payment verification failed', status: 'failed', order });
    }

  // Update order in a transaction
const trackingCode = order.trackingCode || `TRK-${order.id}-${Date.now()}`;
const updatedOrder = await prisma.$transaction(async (tx) => {
  const updatedOrder = await tx.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: 'paid',
      status: 'confirmed',
      trackingCode,
      updatedAt: new Date(),
    },
    include: {
      items: {
        include: {
          pharmacyMedication: {
            include: { medication: true, pharmacy: true },
          },
        },
      },
      prescription: true,
    },
  });
  return updatedOrder;
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
        trackingCode,
        prescription: order.prescription
          ? {
              id: order.prescription.id,
              status: order.prescription.status,
              fileUrl: order.prescription.fileUrl,
            }
          : null,
        items: order.items.map(item => ({
          id: item.id,
          medication: {
            name: item.pharmacyMedication.medication.name,
            prescriptionRequired: item.pharmacyMedication.medication.prescriptionRequired,
          },
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