const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { isValidOrderReference } = require('../utils/validation');
const { generateTrackingCode } = require('../utils/tracking');
const prisma = new PrismaClient();

async function confirmOrder({ reference, session, userId }) {
  try {
    console.log('confirmOrder called with:', { reference, session, userId });
    let transactionRef = null;

  // Find transaction reference if provided
  if (reference) {
    console.log('Validating reference:', reference);
    if (!isValidOrderReference(reference)) {
      console.log('Reference validation failed for:', reference);
      throw new Error('Invalid payment reference format');
    }

    try {
      // First try to find by transactionReference (the actual reference from Paystack)
      transactionRef = await prisma.transactionReference.findFirst({
        where: { transactionReference: reference },
      });
      
      if (!transactionRef) {
        // Fallback: try to find by orderReferences (the order-specific references)
        transactionRef = await prisma.transactionReference.findFirst({
          where: { orderReferences: { has: reference } },
        });
      }
      
      console.log('Transaction reference lookup result:', transactionRef);
    } catch (error) {
      console.error('Error looking up transaction reference:', error);
      throw new Error('Database error while looking up transaction reference');
    }

    if (!transactionRef) {
      console.log('No transaction reference found for:', reference);
      throw new Error('Transaction reference not found');
    }
  }

  // Fetch orders: prioritize transactionRef.orderReferences if available, else fallback to checkoutSessionId
  let orders = [];
  try {
    if (transactionRef) {
      console.log('Looking up orders by transaction reference:', {
        userId,
        orderReferences: transactionRef.orderReferences
      });
      orders = await prisma.order.findMany({
        where: {
          userIdentifier: userId,
          paymentReference: { in: transactionRef.orderReferences },
        },
        include: {
          items: {
            include: {
              medicationAvailability: {
                include: {
                  medication: {
                    include: { genericMedication: true },
                  },
                  pharmacy: true,
                },
              },
            },
          },
          prescription: {
            include: { prescriptionMedications: true },
          },
          pharmacy: true,
        },
      });
    } else {
      console.log('Looking up orders by session:', { userId, session });
      orders = await prisma.order.findMany({
        where: {
          userIdentifier: userId,
          checkoutSessionId: session,
          status: { in: ['PENDING', 'CONFIRMED', 'PAID'] },
        },
        include: {
          items: {
            include: {
              medicationAvailability: {
                include: {
                  medication: {
                    include: { genericMedication: true },
                  },
                  pharmacy: true,
                },
              },
            },
          },
          prescription: {
            include: { prescriptionMedications: true },
          },
          pharmacy: true,
        },
      });
    }
    console.log('Orders found:', orders.length);
  } catch (error) {
    console.error('Error fetching orders:', error);
    throw new Error('Database error while fetching orders');
  }

  if (orders.length === 0) {
    console.log('No orders found with transaction reference, trying fallback with session only');
    
    // Fallback: try to find orders by session only
    orders = await prisma.order.findMany({
      where: {
        userIdentifier: userId,
        checkoutSessionId: session,
        status: { in: ['PENDING', 'CONFIRMED', 'PAID'] },
      },
      include: {
        items: {
          include: {
            medicationAvailability: {
              include: {
                medication: {
                  include: { genericMedication: true },
                },
                pharmacy: true,
              },
            },
          },
        },
        prescription: {
          include: { prescriptionMedications: true },
        },
        pharmacy: true,
      },
    });
    
    if (orders.length === 0) {
      throw new Error('Orders not found');
    }
    
    console.log('Found orders by session fallback:', orders.length);
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
    try {
      const paystackResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${transactionRef.transactionReference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('Paystack response:', paystackResponse.data);

      if (!paystackResponse.data.status || paystackResponse.data.data.status !== 'success') {
        console.log('Payment verification failed, updating orders to failed status');
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
    } catch (error) {
      console.error('Error verifying Paystack transaction:', error);
      if (error.response) {
        console.error('Paystack API error:', error.response.data);
      }
      throw new Error('Payment verification failed: ' + error.message);
    }
  } else {
    console.log('No transaction reference found, skipping Paystack verification');
  }

  // Check for verified prescriptions
  const verifiedPrescription = await prisma.prescription.findFirst({
    where: {
      userIdentifier: userId,
      status: 'VERIFIED',
    },
    include: { prescriptionMedications: true },
    orderBy: [{ createdAt: 'desc' }],
  });

  // Update orders in a transaction
  console.log('Starting order update transaction');
  const updatedOrders = await prisma.$transaction(async (tx) => {
    const updated = [];
    for (const order of orders) {
      console.log('Processing order:', { id: order.id, status: order.status, paymentStatus: order.paymentStatus });
      
      let newStatus = order.status;
      let newPaymentStatus = order.paymentStatus;
      let newPrescriptionId = order.prescriptionId;

      const requiresPrescription = order.items.some(
        item => item.medicationAvailability.medication.prescriptionRequired
      );

      if (requiresPrescription && verifiedPrescription) {
        const orderMedicationIds = order.items
          .filter(item => item.medicationAvailability.medication.prescriptionRequired)
          .map(item => item.medicationAvailability.medicationId);
        const prescriptionMedicationIds = verifiedPrescription.prescriptionMedications.map(pm => pm.medicationId);
        const isPrescriptionValid = orderMedicationIds.every(id => prescriptionMedicationIds.includes(id));

        if (isPrescriptionValid && (transactionRef?.orderReferences.includes(order.paymentReference) || !transactionRef)) {
          newStatus = 'CONFIRMED';
          newPaymentStatus = 'PAID';
          newPrescriptionId = verifiedPrescription.id;
        } else if (order.status === 'PENDING_PRESCRIPTION') {
          status = 'PENDING_PRESCRIPTION';
        }
      } else if (!requiresPrescription && (transactionRef?.orderReferences.includes(order.paymentReference) || !transactionRef)) {
        newStatus = 'CONFIRMED';
        newPaymentStatus = 'PAID';
      } else if (order.status === 'PENDING_PRESCRIPTION') {
        status = 'PENDING_PRESCRIPTION';
      }

      console.log('Updating order with:', { newStatus, newPaymentStatus, trackingCode });

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
              medicationAvailability: {
                include: {
                  medication: {
                    include: { genericMedication: true },
                  },
                  pharmacy: true,
                },
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
  console.log('Order update transaction completed');

  console.log('Payment verified or session retrieved:', {
    reference,
    session,
    trackingCode,
    orderCount: updatedOrders.length,
    orderIds: updatedOrders.map(o => o.id),
  });

  // Format response with orders grouped by pharmacy
  const ordersByPharmacy = updatedOrders
  .filter(order => order.status === 'CONFIRMED' && order.paymentStatus === 'PAID')
  .reduce((acc, order) => {
    const pharmacyId = order.pharmacyId;
    if (!acc[pharmacyId]) {
      acc[pharmacyId] = {
        pharmacy: {
          id: pharmacyId,
          name: order.pharmacy?.name || 'Unknown',
          address: order.pharmacy?.address || '',
          logoUrl: order.pharmacy?.logoUrl || '',
          phone: order.pharmacy?.phone || '',
          operatingHours: order.pharmacy?.operatingHours || '',
          ward: order.pharmacy?.ward || '',
          lga: order.pharmacy?.lga || '',
          state: order.pharmacy?.state || '',
        },
        orders: [],
        subtotal: 0,
      };
    }
    acc[pharmacyId].orders.push({
      id: order.id,
      name: order.name,
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
          brandName: item.medicationAvailability.medication.brandName,
          genericName: item.medicationAvailability.medication.genericMedication?.name,
          prescriptionRequired: item.medicationAvailability.medication.prescriptionRequired,
        },
        quantity: item.quantity,
        price: item.price,
      })),
    });
    acc[pharmacyId].subtotal += order.totalPrice;
    return acc;
  }, {});

  return {
    message: status === 'completed' ? 'Payment verified' : 'Orders retrieved, some awaiting verification',
    status,
    checkoutSessionId: session,
    trackingCode,
    pharmacies: Object.values(ordersByPharmacy),
  };
  } catch (error) {
    console.error('Error in confirmOrder:', error);
    throw error;
  }
}

module.exports = { confirmOrder };