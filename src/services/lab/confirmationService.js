const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { isValidReference } = require('../../utils/validation');
const { generateTrackingCode } = require('../../utils/tracking');
const prisma = new PrismaClient();

async function confirmBooking({ reference, session, userId }) {
  let transactionRef = null;

  // Find transaction reference if provided
  if (reference) {
    if (!isValidReference(reference)) {
      throw new Error('Invalid payment reference format');
    }

    transactionRef = await prisma.transactionReference.findFirst({
      where: { bookingReferences: { has: reference } },
    });

    if (!transactionRef) {
      throw new Error('Transaction reference not found');
    }
  }

  // Fetch bookings: prioritize transactionRef.bookingReferences if available, else fallback to checkoutSessionId
  let bookings = [];
  if (transactionRef) {
    bookings = await prisma.booking.findMany({
      where: {
        patientIdentifier: userId,
        paymentReference: { in: transactionRef.bookingReferences },
      },
      include: {
        items: {
          include: {
            labTest: {
              include: { test: true, lab: true },
            },
          },
        },
        testOrder: {
          include: { TestOrderTest: true },
        },
        lab: true,
      },
    });
  } else {
    bookings = await prisma.booking.findMany({
      where: {
        patientIdentifier: userId,
        checkoutSessionId: session,
        status: { in: ['pending', 'confirmed', 'paid'] },
      },
      include: {
        items: {
          include: {
            labTest: {
              include: { test: true, lab: true },
            },
          },
        },
        testOrder: {
          include: { TestOrderTest: true },
        },
        lab: true,
      },
    });
  }

  if (bookings.length === 0) {
    throw new Error('Bookings not found');
  }

  console.log('Fetched bookings:', {
    bookingCount: bookings.length,
    bookingIds: bookings.map(b => b.id),
    paymentReferences: bookings.map(b => b.paymentReference),
    checkoutSessionId: session,
  });

  // Generate or reuse a tracking code
  const existingTrackingCode = bookings.find(b => b.trackingCode)?.trackingCode;
  const trackingCode = existingTrackingCode || generateTrackingCode(session, bookings[0]?.id);
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
        for (const booking of bookings) {
          if (transactionRef.bookingReferences.includes(booking.paymentReference)) {
            await tx.booking.update({
              where: { id: booking.id },
              data: { paymentStatus: 'failed', updatedAt: new Date() },
            });
          }
        }
      });
      throw new Error('Payment verification failed');
    }
  }

  // Check for verified test orders
  const verifiedTestOrder = await prisma.testOrder.findFirst({
    where: {
      patientIdentifier: userId,
      status: 'verified',
    },
    include: { TestOrderTest: true },
    orderBy: [{ createdAt: 'desc' }],
  });

  // Update bookings in a transaction
  const updatedBookings = await prisma.$transaction(async (tx) => {
    const updated = [];
    for (const booking of bookings) {
      let newStatus = booking.status;
      let newPaymentStatus = booking.paymentStatus;
      let newTestOrderId = booking.testOrderId;

      const requiresTestOrder = booking.items.some(
        item => item.labTest.test.orderRequired
      );

      if (requiresTestOrder && verifiedTestOrder) {
        const bookingTestIds = booking.items
          .filter(item => item.labTest.test.orderRequired)
          .map(item => item.labTest.testId);
        const testOrderTestIds = verifiedTestOrder.TestOrderTest.map(tot => tot.testId);
        const isTestOrderValid = bookingTestIds.every(id => testOrderTestIds.includes(id));

        if (isTestOrderValid && transactionRef?.bookingReferences.includes(booking.paymentReference)) {
          newStatus = 'confirmed';
          newPaymentStatus = 'paid';
          newTestOrderId = verifiedTestOrder.id;
        } else if (booking.status === 'pending_testorder') {
          status = 'pending_testorder';
        }
      } else if (!requiresTestOrder && transactionRef?.bookingReferences.includes(booking.paymentReference)) {
        newStatus = 'confirmed';
        newPaymentStatus = 'paid';
      } else if (booking.status === 'pending_testorder') {
        status = 'pending_testorder';
      }

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: newPaymentStatus,
          status: newStatus,
          trackingCode,
          testOrderId: newTestOrderId,
          updatedAt: new Date(),
        },
        include: {
          items: {
            include: {
              labTest: {
                include: { test: true, lab: true },
              },
            },
          },
          testOrder: true,
          lab: true,
        },
      });
      updated.push(updatedBooking);
    }
    return updated;
  });

  console.log('Payment verified or session retrieved:', {
    reference,
    session,
    trackingCode,
    bookingCount: updatedBookings.length,
    bookingIds: updatedBookings.map(b => b.id),
  });

  // Format response with bookings grouped by lab
  const bookingsByLab = updatedBookings
    .filter(booking => booking.status === 'confirmed' && booking.paymentStatus === 'paid')
    .reduce((acc, booking) => {
      const labId = booking.labId;
      if (!acc[labId]) {
        acc[labId] = {
          lab: {
            id: labId,
            name: booking.lab?.name || 'Unknown',
            address: booking.lab?.address || '',
          },
          bookings: [],
          subtotal: 0,
        };
      }
      acc[labId].bookings.push({
        id: booking.id,
        totalPrice: booking.totalPrice,
        status: booking.status,
        deliveryMethod: booking.deliveryMethod,
        address: booking.address,
        paymentReference: booking.paymentReference,
        testOrder: booking.testOrder
          ? {
              id: booking.testOrder.id,
              status: booking.testOrder.status,
              fileUrl: booking.testOrder.fileUrl,
            }
          : null,
        items: booking.items.map(item => ({
          id: item.id,
          test: {
            name: item.labTest.test.name,
            orderRequired: item.labTest.test.orderRequired,
          },
          price: item.price,
        })),
      });
      acc[labId].subtotal += booking.totalPrice;
      return acc;
    }, {});

  return {
    message: status === 'completed' ? 'Payment verified' : 'Bookings retrieved, some awaiting verification',
    status,
    checkoutSessionId: session,
    trackingCode,
    labs: Object.values(bookingsByLab),
  };
}

module.exports = { confirmBooking };