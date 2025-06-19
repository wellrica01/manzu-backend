const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const router = express.Router();
const prisma = new PrismaClient();

// Validate reference format
const isValidReference = (reference) => typeof reference === 'string' && reference.startsWith('order_') && reference.length > 10;

function generateTrackingCode(session, fallbackId) {
  const id = Number.isFinite(Number(session)) ? Number(session) :
             Number.isFinite(Number(fallbackId)) ? Number(fallbackId) : 0;
  const timestamp = Date.now();
  return `TRK-SESSION-${id}-${timestamp}`;
}

router.get('/', async (req, res) => {
  try {
    const { reference, session } = req.query;
    const userId = req.headers['x-guest-id'];

    // Validate input
    if (!userId || !session) {
      console.error('Missing session or userId:', { reference, session, userId });
      return res.status(400).json({ message: 'Session ID and guest ID required' });
    }

    // Initialize transactionRef as null
    let transactionRef = null;

    // Find transaction reference if reference is provided
    if (reference) {
      if (!isValidReference(reference)) {
        console.error('Invalid reference format:', { reference });
        return res.status(400).json({ message: 'Invalid payment reference format' });
      }

      transactionRef = await prisma.transactionReference.findFirst({
        where: { orderReferences: { has: reference } },
      });

      if (!transactionRef) {
        console.error('Transaction reference not found for:', { reference });
        return res.status(400).json({ message: 'Transaction reference not found' });
      }
    }

    // Fetch orders: prioritize transactionRef.orderReferences if available, else fallback to checkoutSessionId
    let orders = [];
    if (transactionRef) {
      orders = await prisma.order.findMany({
        where: {
          patientIdentifier: userId,
          paymentReference: { in: transactionRef.orderReferences },
        },
        include: {
          items: {
            include: {
              pharmacyMedication: {
                include: { medication: true, pharmacy: true },
              },
            },
          },
          prescription: {
            include: { PrescriptionMedication: true },
          },
          pharmacy: true,
        },
      });
    } else {
      orders = await prisma.order.findMany({
        where: {
          patientIdentifier: userId,
          checkoutSessionId: session,
          status: { in: ['pending', 'confirmed', 'paid'] }, // Exclude pending_prescription unless paid
        },
        include: {
          items: {
            include: {
              pharmacyMedication: {
                include: { medication: true, pharmacy: true },
              },
            },
          },
          prescription: {
            include: { PrescriptionMedication: true },
          },
          pharmacy: true,
        },
      });
    }

    if (orders.length === 0) {
      console.error('Orders not found:', { reference, session, userId });
      return res.status(404).json({ message: 'Orders not found' });
    }

    console.log('Fetched orders:', {
      orderCount: orders.length,
      orderIds: orders.map(o => o.id),
      paymentReferences: orders.map(o => o.paymentReference),
      checkoutSessionId: session,
    });

    // Generate or reuse a tracking code for the session
    const existingTrackingCode = orders.find(o => o.trackingCode)?.trackingCode;
    const trackingCode = existingTrackingCode || generateTrackingCode(session, orders[0]?.id);
    let status = 'completed';

    // Verify Paystack transaction if transactionRef is found
    if (transactionRef) {
      console.log('Verifying Paystack transaction:', { transactionReference: transactionRef.transactionReference });
      const paystackResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${transactionRef.transactionReference}`,
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
            if (transactionRef.orderReferences.includes(order.paymentReference)) {
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

    // Check for verified prescriptions to cover pending orders
    const verifiedPrescription = await prisma.prescription.findFirst({
      where: {
        patientIdentifier: userId,
        status: 'verified',
      },
      include: { PrescriptionMedication: true },
      orderBy: [{ createdAt: 'desc' }],
    });

    // Update orders in a transaction
    const updatedOrders = await prisma.$transaction(async (tx) => {
      const updated = [];
      for (const order of orders) {
        let newStatus = order.status;
        let newPaymentStatus = order.paymentStatus;
        let newPrescriptionId = order.prescriptionId;

        // Check if order requires prescription
        const requiresPrescription = order.items.some(
          item => item.pharmacyMedication.medication.prescriptionRequired
        );

        if (requiresPrescription && verifiedPrescription) {
          const orderMedicationIds = order.items
            .filter(item => item.pharmacyMedication.medication.prescriptionRequired)
            .map(item => item.pharmacyMedication.medicationId);
          const prescriptionMedicationIds = verifiedPrescription.PrescriptionMedication.map(pm => pm.medicationId);
          const isPrescriptionValid = orderMedicationIds.every(id => prescriptionMedicationIds.includes(id));

          if (isPrescriptionValid && transactionRef?.orderReferences.includes(order.paymentReference)) {
            newStatus = 'confirmed';
            newPaymentStatus = 'paid';
            newPrescriptionId = verifiedPrescription.id;
          } else if (order.status === 'pending_prescription') {
            status = 'pending_prescription';
          }
        } else if (!requiresPrescription && transactionRef?.orderReferences.includes(order.paymentReference)) {
          newStatus = 'confirmed';
          newPaymentStatus = 'paid';
        } else if (order.status === 'pending_prescription') {
          status = 'pending_prescription';
        }

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: newPaymentStatus,
            status: newStatus,
            trackingCode,
            prescriptionId: newPrescriptionId,
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

    console.log('Payment verified or session retrieved:', {
      reference,
      session,
      trackingCode,
      orderCount: updatedOrders.length,
      orderIds: updatedOrders.map(o => o.id),
    });

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
        paymentReference: order.paymentReference,
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
      checkoutSessionId: session,
      trackingCode,
      pharmacies: Object.values(ordersByPharmacy),
    });
  } catch (error) {
    console.error('Confirmation error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;