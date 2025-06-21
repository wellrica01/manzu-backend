const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function trackBookings(trackingCode) {
  console.log('Searching for bookings by tracking code:', { trackingCode });

  const bookings = await prisma.booking.findMany({
    where: {
      trackingCode,
      status: {
        in: ['confirmed', 'processing', 'scheduled', 'completed', 'cancelled'],
      },
    },
    select: {
      id: true,
      patientIdentifier: true,
      totalPrice: true,
      address: true,
      deliveryMethod: true,
      trackingCode: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      updatedAt: true,
      filledAt: true,
      cancelledAt: true,
      cancelReason: true,
      testOrderId: true,
      testOrder: {
        select: {
          id: true,
          status: true,
          fileUrl: true,
          verified: true,
          createdAt: true,
          TestOrderTest: {
            select: {
              testId: true,
              quantity: true,
              Test: {
                select: { id: true, name: true, description: true },
              },
            },
          },
        },
      },
      lab: {
        select: { id: true, name: true, address: true },
      },
      items: {
        select: {
          id: true,
          price: true,
          labTest: {
            select: {
              test: {
                select: { id: true, name: true, description: true, orderRequired: true },
              },
              lab: {
                select: { name: true, address: true },
              },
              available: true,
            },
          },
        },
      },
    },
  });

  if (bookings.length === 0) {
    console.error('Bookings not found for tracking code:', { trackingCode });
    throw new Error('Bookings not found or not ready for tracking');
  }

  console.log('Bookings found:', { bookingIds: bookings.map(b => b.id), trackingCode, status: bookings.map(b => b.status) });

  return {
    message: 'Bookings found',
    bookings: bookings.map(booking => ({
      id: booking.id,
      patientIdentifier: booking.patientIdentifier,
      totalPrice: booking.totalPrice,
      address: booking.address,
      deliveryMethod: booking.deliveryMethod,
      trackingCode: booking.trackingCode,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      filledAt: booking.filledAt,
      cancelledAt: booking.cancelledAt,
      cancelReason: booking.cancelReason,
      testOrder: booking.testOrder ? {
        id: booking.testOrder.id,
        status: booking.testOrder.status,
        fileUrl: booking.testOrder.fileUrl,
        verified: booking.testOrder.verified,
        createdAt: booking.testOrder.createdAt,
        tests: booking.testOrder.TestOrderTest.map(tot => ({
          testId: tot.testId,
          name: tot.Test.name,
          description: tot.Test.description,
          quantity: tot.quantity,
        })),
      } : null,
      lab: {
        id: booking.lab.id,
        name: booking.lab.name,
        address: booking.lab.address,
      },
      items: booking.items.map(item => ({
        id: item.id,
        test: {
          id: item.labTest.test.id,
          name: item.labTest.test.name,
          description: item.labTest.test.description,
          orderRequired: item.labTest.test.orderRequired,
        },
        lab: {
          name: item.labTest.lab.name,
          address: item.labTest.lab.address,
        },
        price: item.price,
        available: item.labTest.available,
      })),
    })),
  };
}

module.exports = { trackBookings };