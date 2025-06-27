const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { isValidOrderReference } = require('../utils/validation');
const { generateTrackingCode } = require('../utils/tracking');
const prisma = new PrismaClient();

async function confirmOrder({ reference, session, userId }) {
  let transactionRef = null;

  // Find transaction reference if provided
  if (reference) {
    if (!isValidOrderReference(reference)) {
      throw new Error('Invalid payment reference format');
    }

    transactionRef = await prisma.transactionReference.findFirst({
      where: { orderReferences: { has: reference } },
    });

    if (!transactionRef) {
      throw new Error('Transaction reference not found');
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
            providerService: {
              include: { service: true, provider: true },
            },
          },
        },
        prescription: {
          include: { prescriptionServices: true },
        },
        provider: true,
      },
    });
  } else {
    orders = await prisma.order.findMany({
      where: {
        patientIdentifier: userId,
        checkoutSessionId: session,
        status: { in: ['pending', 'confirmed', 'paid', 'pending_prescription'] },
      },
      include: {
        items: {
          include: {
            providerService: {
              include: { service: true, provider: true },
            },
          },
        },
        prescription: {
          include: { prescriptionServices: true },
        },
        provider: true,
      },
    });
  }

  if (orders.length === 0) {
    throw new Error('Orders not found');
  }

  console.log('Fetched orders:', {
    orderCount: orders.length,
    orderIds: orders.map(o => o.id),
    paymentReferences: orders.map(o => o.paymentReference),
    checkoutSessionId: session,
  });

  // Generate or reuse a tracking code
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
      throw new Error('Payment verification failed');
    }
  }

  // Check for verified prescriptions
  const verifiedPrescription = await prisma.prescription.findFirst({
    where: {
      patientIdentifier: userId,
      status: 'verified',
    },
    include: { prescriptionServices: true },
    orderBy: [{ createdAt: 'desc' }],
  });

  // Update orders in a transaction
  const updatedOrders = await prisma.$transaction(async (tx) => {
    const updated = [];
    for (const order of orders) {
      let newStatus = order.status;
      let newPaymentStatus = order.paymentStatus;
      let newPrescriptionId = order.prescriptionId;

      const requiresPrescription = order.items.some(
        item => item.providerService.service.prescriptionRequired
      );

      if (requiresPrescription && verifiedPrescription) {
        const orderServiceIds = order.items
          .filter(item => item.providerService.service.prescriptionRequired)
          .map(item => item.providerService.serviceId);
        const prescriptionServiceIds = verifiedPrescription.prescriptionServices.map(ps => ps.serviceId);
        const isPrescriptionValid = orderServiceIds.every(id => prescriptionServiceIds.includes(id));

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
              providerService: {
                include: { service: true, provider: true },
              },
            },
          },
          prescription: true,
          provider: true,
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

  // Format response with orders grouped by provider
  const ordersByProvider = updatedOrders
    .filter(order => order.status === 'confirmed' && order.paymentStatus === 'paid')
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
        prescription: order.prescription
          ? {
              id: order.prescription.id,
              status: order.prescription.status,
              fileUrl: order.prescription.fileUrl,
            }
          : null,
        items: order.items.map(item => ({
          id: item.id,
          service: {
            name: item.providerService.service.name,
            type: item.providerService.service.type,
            prescriptionRequired: item.providerService.service.prescriptionRequired,
          },
          quantity: item.quantity,
          price: item.price,
        })),
      });
      acc[providerId].subtotal += order.totalPrice;
      return acc;
    }, {});

  return {
    message: status === 'completed' ? 'Payment verified and orders confirmed' : 'Orders retrieved, some awaiting verification',
    status,
    checkoutSessionId: session,
    trackingCode,
    providers: Object.values(ordersByProvider),
  };
}

module.exports = { confirmOrder };