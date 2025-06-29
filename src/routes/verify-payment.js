const express = require('express');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { generateTrackingCode } = require('../utils/tracking');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  console.log('Verify-payment endpoint called:', { query: req.query, headers: req.headers });
  try {
    const { reference, session: checkoutSessionId } = req.query;
    const patientIdentifier = req.headers['x-guest-id'];

    // Validate query parameters
    if (!reference || !checkoutSessionId || !patientIdentifier) {
      console.error('Missing required parameters:', { reference, checkoutSessionId, patientIdentifier });
      return res.status(400).json({ message: 'Reference, session, and patient identifier are required' });
    }

    // Fetch transaction reference from the database
    const transactionRef = await prisma.transactionReference.findFirst({
      where: { transactionReference: reference, checkoutSessionId },
    });

    if (!transactionRef) {
      console.error('Transaction reference not found:', { reference, checkoutSessionId });
      return res.status(404).json({ message: 'Transaction reference not found' });
    }

    // Fetch orders associated with the transaction
    const orders = await prisma.order.findMany({
      where: {
        patientIdentifier,
        checkoutSessionId,
        paymentReference: { in: transactionRef.orderReferences },
        status: { in: ['pending', 'confirmed', 'pending_prescription'] }, // Updated to match OrderStatus enum
      },
      include: {
        items: {
          include: {
            service: true,
            prescriptions: { include: { prescription: true } },
          },
        },
        provider: true,
      },
    });

    if (orders.length === 0) {
      console.error('Orders not found:', { checkoutSessionId, patientIdentifier, orderReferences: transactionRef.orderReferences });
      return res.status(404).json({ message: 'Orders not found' });
    }

    // Verify Paystack transaction
    console.log('Verifying Paystack transaction:', { transactionReference: reference });
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
        for (const order of orders) {
          await tx.order.update({
            where: { id: order.id },
            data: { paymentStatus: 'failed', updatedAt: new Date() }, // Updated to match PaymentStatus enum
          });
        }
      });
      return res.status(400).json({ message: 'Payment verification failed' });
    }

    // Generate or reuse tracking code
    const existingTrackingCode = orders.find((o) => o.trackingCode)?.trackingCode;
    const trackingCode = existingTrackingCode || generateTrackingCode(checkoutSessionId, orders[0]?.id);

    // Update orders in a transaction
    const updatedOrders = await prisma.$transaction(async (tx) => {
      const updated = [];
      for (const order of orders) {
        if (transactionRef.orderReferences.includes(order.paymentReference)) {
          const requiresPrescription = order.items.some(
            (item) => item.service.prescriptionRequired
          );
          const hasValidPrescription = order.items
            .filter((item) => item.service.prescriptionRequired)
            .every((item) => item.prescriptions.length > 0);

          let newStatus = order.status;
          let newPaymentStatus = order.paymentStatus;

          if (!requiresPrescription || hasValidPrescription) {
            newStatus = 'confirmed';
            newPaymentStatus = 'paid';
          } else {
            newStatus = 'pending_prescription';
            newPaymentStatus = 'pending';
          }

          const updatedOrder = await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: newPaymentStatus,
              status: newStatus,
              trackingCode,
              updatedAt: new Date(),
            },
            include: {
              items: {
                include: { service: true, prescriptions: true },
              },
              provider: true,
            },
          });
          updated.push(updatedOrder);
        }
      }
      return updated;
    });

    // Format response with orders grouped by provider
    const ordersByProvider = updatedOrders
      .filter((order) => order.status === 'confirmed' && order.paymentStatus === 'paid')
      .reduce((acc, order) => {
        const providerId = order.providerId;
        if (!acc[providerId]) {
          acc[providerId] = {
            provider: {
              id: providerId,
              name: order.provider?.name || 'Unknown',
              address: order.provider?.address || '',
            },
            orders: [],
            subtotal: 0,
          };
        }
        acc[providerId].orders.push({
          id: order.id,
          totalPrice: order.totalPrice,
          status: order.status,
          fulfillmentMethod: order.fulfillmentMethod,
          address: order.address,
          paymentReference: order.paymentReference,
          items: order.items.map((item) => ({
            id: item.id,
            service: {
              name: item.service.name,
              type: item.service.type,
              prescriptionRequired: item.service.prescriptionRequired,
            },
            quantity: item.quantity,
            price: item.price,
          })),
        });
        acc[providerId].subtotal += order.totalPrice;
        return acc;
      }, {});

    console.log('Payment verified:', {
      reference,
      checkoutSessionId,
      orderIds: updatedOrders.map((o) => o.id),
      trackingCode,
    });

    res.status(200).json({
      message: 'Payment verified and orders confirmed',
      status: updatedOrders.some((o) => o.status === 'pending_prescription') ? 'pending_prescription' : 'completed',
      checkoutSessionId,
      trackingCode,
      providers: Object.values(ordersByProvider),
    });
  } catch (error) {
    console.error('Payment verification error:', {
      message: error.message,
      stack: error.stack,
      query: req.query,
      headers: req.headers,
    });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;