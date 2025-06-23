const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { isValidBookingReference } = require('../../utils/validation');
const { generateTrackingCode } = require('../../utils/tracking');
const prisma = new PrismaClient();

async function confirmBooking({ reference, session, userId }) {
  let transactionRef = null;

  // Find transaction reference if provided
  if (reference) {
    if (!isValidBookingReference(reference)) {
      throw new Error('Invalid payment reference format');
    }

    transactionRef = await prisma.transactionReference.findFirst({
      where: { orderReferences: { has: reference } },
    });

    if (!transactionRef) {
      throw new Error('Transaction reference not found');
    }
  }

  // Fetch bookings: prioritize transactionRef.orderReferences if available, else fallback to checkoutSessionId
  let bookings = [];
  if (transactionRef) {
    bookings = await prisma.booking.findMany({
      where: {
        patientIdentifier: userId,
        paymentReference: { in: transactionRef.orderReferences },
      },
      include: {
        BookingItem: {
          include: {
            LabTest: {
              include: { Test: true, Lab: true },
            },
          },
        },
        TestOrder: {
          include: { TestOrderTest: true },
        },
        Lab: true,
      },
    });
  } else {
    bookings = await prisma.booking.findMany({
      where: {
        patientIdentifier: userId,
        checkoutSessionId: session,
        status: { in: ['pending', 'confirmed'] },
      },
      include: {
        BookingItem: {
          include: {
            LabTest: {
              include: { Test: true, Lab: true },
            },
          },
        },
        TestOrder: {
          include: { TestOrderTest: true },
        },
        Lab: true,
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
  let status = 'confirmed';

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
          if (transactionRef.orderReferences.includes(booking.paymentReference)) {
            await tx.booking.update({
              where: { id: booking.id },
              data: { paymentStatus: 'failed', updatedAt: new Date().toISOString() },
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

      const requiresTestOrder = booking.BookingItem.some(
        item => item.LabTest.Test.orderRequired
      );

      if (requiresTestOrder && verifiedTestOrder) {
        const bookingTestIds = booking.BookingItem
          .filter(item => item.LabTest.Test.orderRequired)
          .map(item => item.LabTest.testId);
        const testOrderTestIds = verifiedTestOrder.TestOrderTest.map(tot => tot.testId);
        const isTestOrderValid = bookingTestIds.every(id => testOrderTestIds.includes(id));

        if (isTestOrderValid && transactionRef?.orderReferences.includes(booking.paymentReference)) {
          newStatus = 'confirmed';
          newPaymentStatus = 'paid';
          newTestOrderId = verifiedTestOrder.id;
        } else {
          newStatus = 'pending'; // Awaiting test order verification
          status = 'pending';
        }
      } else if (!requiresTestOrder && transactionRef?.orderReferences.includes(booking.paymentReference)) {
        newStatus = 'confirmed';
        newPaymentStatus = 'paid';
      } else {
        newStatus = 'pending'; // Awaiting test order or payment
        status = 'pending';
      }

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: newPaymentStatus,
          status: newStatus,
          trackingCode,
          testOrderId: newTestOrderId,
          updatedAt: new Date().toISOString(),
        },
        include: {
          BookingItem: {
            include: {
              LabTest: {
                include: { Test: true, Lab: true },
              },
            },
          },
          TestOrder: true,
          Lab: true,
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
            name: booking.Lab?.name || 'Unknown',
            address: booking.Lab?.address || '',
          },
          bookings: [],
          subtotal: 0,
        };
      }
      acc[labId].bookings.push({
        id: booking.id,
        totalPrice: booking.totalPrice,
        status: booking.status,
        deliveryMethod: booking.fulfillmentType,
        address: booking.address,
        paymentReference: booking.paymentReference,
        testOrder: booking.TestOrder
          ? {
              id: booking.TestOrder.id,
              status: booking.TestOrder.status,
              fileUrl: booking.TestOrder.fileUrl,
            }
          : null,
        items: booking.BookingItem.map(item => ({
          id: item.id,
          test: {
            name: item.LabTest.Test.name,
            orderRequired: item.LabTest.Test.orderRequired,
          },
          price: item.price,
        })),
      });
      acc[labId].subtotal += booking.totalPrice;
      return acc;
    }, {});

  return {
    message: status === 'confirmed' ? 'Payment verified and bookings confirmed' : 'Bookings retrieved, some awaiting verification',
    status,
    checkoutSessionId: session,
    trackingCode,
    labs: Object.values(bookingsByLab),
  };
}

module.exports = { confirmBooking };