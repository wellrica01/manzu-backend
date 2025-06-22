const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { recalculateBookingTotal } = require('../../utils/lab/bookingUtils');
const prisma = new PrismaClient();

async function addToBooking({ testId, labId, quantity, userId }) {
  // Generate userId if not provided
  userId = userId || uuidv4();

  // Check if lab exists
  const lab = await prisma.lab.findUnique({ where: { id: labId } });
  if (!lab) {
    throw new Error('Lab not found');
  }

  // Check if a booking already exists for this user
  let booking = await prisma.booking.findFirst({
    where: {
      patientIdentifier: userId,
      status: { in: ['pending_prescription', 'pending', 'cart'] },
    },
  });

  // If booking exists and isn't in 'cart' status, update it
  if (booking) {
    if (booking.status !== 'cart') {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'cart' },
      });
    }
  } else {
    // If no booking exists, create a new one
    booking = await prisma.booking.create({
      data: {
        patientIdentifier: userId,
        status: 'cart',
        totalPrice: 0,
        fulfillmentType: 'unspecified',
        paymentStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // Check if the test is available at the selected lab
  const labTest = await prisma.labTest.findFirst({
    where: { testId, labId, available: true },
  });

  if (!labTest) {
    throw new Error('Test not available at this lab');
  }

  // Perform booking item creation/update and total recalculation in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const bookingItem = await tx.bookingItem.upsert({
      where: {
        bookingId_labTestLabId_labTestTestId: {
          bookingId: booking.id,
          labTestLabId: labId,
          labTestTestId: testId,
        },
      },
      update: {
        price: labTest.price,
      },
      create: {
        bookingId: booking.id,
        labTestLabId: labId,
        labTestTestId: testId,
        price: labTest.price,
      },
    });

    const { updatedBooking } = await recalculateBookingTotal(tx, booking.id);

    return { bookingItem, booking: updatedBooking };
  });

  console.log('Created/Updated BookingItem:', result.bookingItem);
  return { bookingItem: result.bookingItem, userId };
}

async function getBooking(userId) {
  const booking = await prisma.booking.findFirst({
    where: {
      patientIdentifier: userId,
      status: 'cart',
    },
    include: {
      BookingItem: {
        include: {
          LabTest: {
            include: {
              Lab: true,
              Test: true,
            },
          },
        },
      },
      TestOrder: true,
    },
  });

  if (!booking) {
    return { items: [], totalPrice: 0, labs: [] };
  }

  const labGroups = booking.BookingItem.reduce((acc, item) => {
    const labId = item.LabTest?.Lab?.id;
    if (!labId) return acc;

    if (!acc[labId]) {
      acc[labId] = {
        lab: {
          id: labId,
          name: item.LabTest?.Lab?.name ?? "Unknown Lab",
          address: item.LabTest?.Lab?.address ?? "No address",
        },
        items: [],
        subtotal: 0,
      };
    }

    acc[labId].items.push({
      id: item.id,
      test: {
        name: item.LabTest?.Test?.name ?? "Unknown",
        displayName: item.LabTest?.Test?.name ?? "",
        category: item.LabTest?.Test?.category,
        orderRequired: item.LabTest?.Test?.orderRequired ?? false,
      },
      price: item.price,
      labTestTestId: item.labTestTestId,
      labTestLabId: item.labTestLabId,
    });

    acc[labId].subtotal += item.price; // assuming quantity = 1
    return acc;
  }, {});

  const labs = Object.values(labGroups);
  const totalPrice = labs.reduce((sum, p) => sum + p.subtotal, 0);

  console.log('GET /api/test/bookings response:', { labs, totalPrice });

  return {
    labs,
    totalPrice,
    testOrderId: booking.testOrderId ?? booking.TestOrder?.id ?? null,
  };
}


async function updateBookingItem({ bookingItemId, quantity, userId }) {
  const booking = await prisma.booking.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!booking) {
    throw new Error('Booking not found');
  }

  const bookingItem = await prisma.bookingItem.findFirst({
    where: { id: bookingItemId, bookingId: booking.id },
    include: { labTest: true },
  });
  if (!bookingItem) {
    throw new Error('Item not found');
  }

  const labTest = await prisma.labTest.findFirst({
    where: {
      testId: bookingItem.labTestTestId,
      labId: bookingItem.labTestLabId,
      available: true,
    },
  });
  if (!labTest) {
    throw new Error('Test not available');
  }

  // Perform booking item update and total recalculation in a transaction
  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.bookingItem.update({
      where: { id: bookingItemId },
      data: { quantity, price: labTest.price },
    });

    await recalculateBookingTotal(tx, booking.id);

    return item;
  });

  return updatedItem;
}

async function removeFromBooking({ bookingItemId, userId }) {
  const booking = await prisma.booking.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!booking) {
    throw new Error('Booking not found');
  }

  // Perform booking item deletion and total recalculation in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.bookingItem.delete({
      where: { id: bookingItemId, bookingId: booking.id },
    });

    await recalculateBookingTotal(tx, booking.id);
  });
}

module.exports = {
  addToBooking,
  getBooking,
  updateBookingItem,
  removeFromBooking,
};