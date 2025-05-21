const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const router = express.Router();
const prisma = new PrismaClient();

// Validate reference format
const isValidReference = (reference) => typeof reference === 'string' && (reference.startsWith('order_') || reference.startsWith('session_')) && reference.length > 10;

router.get('/', async (req, res) => {
  try {
    const { reference, session } = req.query;
    const userId = req.headers['x-guest-id'];

    // Validate input
    if (!userId || (!reference && !session)) {
      console.error('Missing reference, session, or userId:', { reference, session, userId });
      return res.status(400).json({ message: 'Reference or session ID and guest ID required' });
    }

    // Fetch orders by paymentReference or checkoutSessionId
    const orders = await prisma.order.findMany({
      where: {
        patientIdentifier: userId,
        OR: [
          reference ? { paymentReference: reference } : {},
          session ? { checkoutSessionId: session } : {},
        ].filter(Boolean),
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
        pharmacy: true,
      },
    });

    if (orders.length === 0) {
      console.error('Orders not found:', { reference, session, userId });
      return res.status(404).json({ message: 'Orders not found' });
    }

    // Generate or reuse a tracking code for the session
    const trackingCode = orders[0].trackingCode || `TRK-SESSION-${session || orders[0].id}-${Date.now()}`;
    let status = 'completed';

    // Verify Paystack transaction if reference is provided (OTC orders)
    if (reference) {
      if (!isValidReference(reference)) {
        console.error('Invalid reference format:', { reference });
        return res.status(400).json({ message: 'Invalid payment reference format' });
      }

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
          for (const order of orders) {
            if (order.paymentReference === reference) {
              await tx.order.update({
                where: { id: order.id },
                data: { paymentStatus: 'failed', updatedAt: new Date() },
              });
            }
          }
        });
        return res.status(400).json({ message: 'Payment verification failed', status: 'failed', orders });
      }
    }

// Update orders in a transaction
const updatedOrders = await prisma.$transaction(async (tx) => {
  const updated = [];
  const existingTrackingCode = orders.find(o => o.trackingCode)?.trackingCode;
  const trackingCode = existingTrackingCode || `TRK-SESSION-${session || orders[0].id}-${Date.now()}`;
  for (const order of orders) {
    // Update orders linked to the Paystack reference or any OTC order in the session
    const isOtcOrder = !order.prescriptionId && reference && order.checkoutSessionId === session;
    const newStatus = isOtcOrder ? 'confirmed' : order.status;
    const newPaymentStatus = isOtcOrder ? 'paid' : order.paymentStatus;
    if (order.status === 'pending_prescription') {
      status = 'pending_prescription';
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
          include: {
            pharmacyMedication: {
              include: { medication: true, pharmacy: true },
            },
          },
        },
        prescription: true,
        pharmacy: true,
      },
    });
    updated.push(updatedOrder);
  }
  return updated;
});

    console.log('Payment verified or session retrieved:', { reference, session, trackingCode, orderCount: updatedOrders.length });

    // Format response with orders grouped by pharmacy
    const ordersByPharmacy = updatedOrders.reduce((acc, order) => {
      const pharmacyId = order.pharmacyId;
      if (!acc[pharmacyId]) {
        acc[pharmacyId] = {
          pharmacy: {
            id: pharmacyId,
            name: order.pharmacy?.name || 'Unknown',
            address: order.pharmacy?.address || '',
          },
          orders: [],
          subtotal: 0,
        };
      }
      acc[pharmacyId].orders.push({
        id: order.id,
        totalPrice: order.totalPrice,
        status: order.status,
        deliveryMethod: order.deliveryMethod,
        address: order.address,
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
          quantity: item.quantity,
          price: item.price,
        })),
      });
      acc[pharmacyId].subtotal += order.totalPrice;
      return acc;
    }, {});

    res.status(200).json({
      message: status === 'completed' ? 'Payment verified' : 'Orders retrieved, some awaiting verification',
      status,
      checkoutSessionId: session || orders[0].checkoutSessionId,
      trackingCode,
      pharmacies: Object.values(ordersByPharmacy),
    });
  } catch (error) {
    console.error('Confirmation error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;