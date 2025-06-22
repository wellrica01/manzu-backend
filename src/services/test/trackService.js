const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function trackBookings(trackingCode) {
  console.log('Searching for bookings by tracking code:', { trackingCode });

  const bookings = await prisma.booking.findMany({
    where: {
      trackingCode,
      status: {
        in: ['confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled', 'sample_collected', 'result_ready', 'completed'],
      },
    },
    select: {
      id: true,
      patientIdentifier: true,
      totalPrice: true,
      address: true,
      fulfillmentType: true,
      trackingCode: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      updatedAt: true,
      cancelledAt: true,
      cancelReason: true,
      testOrderId: true,
      TestOrder: {
        select: {
          id: true,
          status: true,
          fileUrl: true,
          verified: true,
          createdAt: true,
          TestOrderTest: {
            select: {
              testId: true,
              Test: {
                select: { id: true, name: true, description: true },
              },
            },
          },
        },
      },
      Lab: {
        select: { id: true, name: true, address: true },
      },
      BookingItem: {
        select: {
          id: true,
          price: true,
          LabTest: {
            select: {
              Test: {
                select: { id: true, name: true, description: true, orderRequired: true },
              },
              Lab: {
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
      fulfillmentType: booking.fulfillmentType,
      trackingCode: booking.trackingCode,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      filledAt: booking.filledAt,
      cancelledAt: booking.cancelledAt,
      cancelReason: booking.cancelReason,
      testOrder: booking.TestOrder ? {
        id: booking.TestOrder.id,
        status: booking.TestOrder.status,
        fileUrl: booking.TestOrder.fileUrl,
        verified: booking.TestOrder.verified,
        createdAt: booking.TestOrder.createdAt,
        tests: booking.TestOrder.TestOrderTest.map(tot => ({
          testId: tot.testId,
          name: tot.Test.name,
          description: tot.Test.description,
        })),
      } : null,
      lab: {
        id: booking.Lab.id,
        name: booking.Lab.name,
        address: booking.Lab.address,
      },
      items: booking.BookingItem.map(item => ({
        id: item.id,
        labTest: {
          test: {
            id: item.LabTest.Test.id,
            name: item.LabTest.Test.name,
            description: item.LabTest.Test.description,
            orderRequired: item.LabTest.Test.orderRequired,
          },
          lab: {
            name: item.LabTest.Lab.name,
            address: item.LabTest.Lab.address,
          },
          available: item.LabTest.available,
        },
        price: item.price,
      })),
    })),
  };
}

module.exports = { trackBookings };