const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { recalculateBookingTotal } = require('../../utils/test/bookingUtils');
const { parse } = require('date-fns');
const prisma = new PrismaClient();

async function addToBooking({ testId, labId, userId }) {
  if (!testId || isNaN(parseInt(testId)) || !labId || isNaN(parseInt(labId))) {
    throw new Error('Invalid test or lab ID');
  }
  userId = userId || uuidv4();

  // Check if lab exists
  const lab = await prisma.lab.findUnique({ where: { id: parseInt(labId) } });
  if (!lab) {
    throw new Error('Lab not found');
  }

  // Check if a booking already exists for this user and lab
  let booking = await prisma.booking.findFirst({
    where: {
      patientIdentifier: userId,
      labId: parseInt(labId),
      status: { in: ['pending_prescription', 'pending', 'cart'] },
    },
  });

  // If booking exists and isn't in 'cart' status, update it
  if (booking && booking.status !== 'cart') {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'cart', updatedAt: new Date() },
    });
  } else if (!booking) {
    // Create a new booking
    booking = await prisma.booking.create({
      data: {
        patientIdentifier: userId,
        labId: parseInt(labId),
        status: 'cart',
        totalPrice: 0,
        fulfillmentType: 'Lab Visit', // Fixed default
        paymentStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // Check if the test is available at the selected lab
  const labTest = await prisma.labTest.findFirst({
    where: { testId: parseInt(testId), labId: parseInt(labId), available: true },
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
          labTestLabId: parseInt(labId),
          labTestTestId: parseInt(testId),
        },
      },
      update: {
        price: labTest.price,
      },
      create: {
        bookingId: booking.id,
        labTestLabId: parseInt(labId),
        labTestTestId: parseInt(testId),
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
  if (!userId) {
    throw new Error('User ID is required');
  }

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        patientIdentifier: userId,
        status: 'cart',
      },
      include: {
        Lab: {
          select: { id: true, name: true, address: true, homeCollectionAvailable: true },
        },
        BookingItem: {
          include: {
            LabTest: {
              include: {
                Lab: { select: { id: true, name: true, address: true } },
                Test: { select: { id: true, name: true, category: true, orderRequired: true, prepInstructions: true, description: true } },
              },
            },
          },
        },
        TestOrder: { select: { id: true } },
      },
    });

    if (!bookings.length) {
      return { bookings: [], labs: [], totalPrice: 0, testOrderId: null };
    }

    const labs = bookings.reduce((acc, booking) => {
      if (!booking.Lab) {
        console.warn(`Booking ${booking.id} has no associated Lab`);
        return acc;
      }

      const items = booking.BookingItem.filter(item => {
        if (!item.LabTest || !item.LabTest.Test) {
          console.warn(`BookingItem ${item.id} has invalid LabTest or Test`);
          return false;
        }
        return true;
      }).map(item => ({
        id: item.id,
        test: {
          id: item.LabTest.Test.id,
          name: item.LabTest.Test.name,
          displayName: item.LabTest.Test.name,
          category: item.LabTest.Test.category,
          description: item.LabTest.Test.description,
          prepInstructions: item.LabTest.Test.prepInstructions,
          orderRequired: item.LabTest.Test.orderRequired,
        },
        price: item.price,
        labTestTestId: item.labTestTestId,
        labTestLabId: item.labTestLabId,
      }));

      if (items.length === 0) {
        return acc;
      }

      const subtotal = items.reduce((sum, item) => sum + item.price, 0);

      acc.push({
        lab: {
          id: booking.Lab.id,
          name: booking.Lab.name,
          address: booking.Lab.address,
          homeCollectionAvailable: booking.Lab.homeCollectionAvailable,
        },
        items,
        subtotal,
      });

      return acc;
    }, []);

    const totalPrice = labs.reduce((sum, lab) => sum + lab.subtotal, 0);

    const bookingsData = bookings.map(booking => ({
      id: booking.id,
      labId: booking.labId,
      timeSlotStart: booking.timeSlotStart?.toISOString() || null,
      fulfillmentType: booking.fulfillmentType,
    }));

    console.log('GET /api/booking response:', { bookings: bookingsData, labs, totalPrice });

    return {
      bookings: bookingsData,
      labs,
      totalPrice,
      testOrderId: bookings[0]?.TestOrder?.id ?? null,
    };
  } catch (error) {
    console.error('Error in getBooking:', error);
    throw new Error('Failed to fetch booking data');
  }
}

async function updateBookingItem({ bookingItemId, userId }) {
  if (!bookingItemId || isNaN(parseInt(bookingItemId)) || !userId) {
    throw new Error('Invalid booking item ID, user ID, or quantity');
  }

  const booking = await prisma.booking.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!booking) {
    throw new Error('Booking not found');
  }

  const bookingItem = await prisma.bookingItem.findFirst({
    where: { id: parseInt(bookingItemId), bookingId: booking.id },
    include: { LabTest: true },
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
      where: { id: parseInt(bookingItemId) },
      data: { price: labTest.price },
    });

    await recalculateBookingTotal(tx, booking.id);

    return item;
  });

  return updatedItem;
}

async function removeFromBooking({ bookingItemId, userId }) {
  if (!bookingItemId || isNaN(parseInt(bookingItemId)) || !userId) {
    throw new Error('Invalid booking item ID or user ID');
  }

  const booking = await prisma.booking.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!booking) {
    throw new Error('Booking not found');
  }

  // Perform booking item deletion and total recalculation in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.bookingItem.delete({
      where: { id: parseInt(bookingItemId), bookingId: booking.id },
    });

    await recalculateBookingTotal(tx, booking.id);
  });
}

async function getTimeSlots({ labId }) {
  if (!labId || isNaN(parseInt(labId))) {
    throw new Error('Invalid lab ID');
  }

  const lab = await prisma.lab.findUnique({
    where: { id: parseInt(labId) },
    select: { operatingHours: true },
  });

  if (!lab) {
    throw new Error('Lab not found');
  }

  // Parse operating hours (e.g., "09:00-17:00")
  const [startHour, endHour] = lab.operatingHours
    ? lab.operatingHours.split('-').map(time => parse(time, 'HH:mm', new Date()))
    : [new Date().setHours(9, 0, 0), new Date().setHours(17, 0, 0)];

  // Generate time slots (30-minute intervals for next 7 days)
  const timeSlots = [];
  const today = new Date();
  for (let day = 0; day < 7; day++) {
    const currentDate = new Date(today);
    currentDate.setDate(today.getDate() + day);
    let currentTime = new Date(currentDate.setHours(startHour.getHours(), startHour.getMinutes(), 0));

    while (currentTime < new Date(currentDate.setHours(endHour.getHours(), endHour.getMinutes(), 0))) {
      const slotStart = new Date(currentTime);
      const slotEnd = new Date(currentTime.setMinutes(currentTime.getMinutes() + 30));

      // Check if slot is booked
      const existingBooking = await prisma.booking.findFirst({
        where: {
          labId: parseInt(labId),
          timeSlotStart: { lte: slotEnd },
          timeSlotEnd: { gte: slotStart },
          status: { not: 'cancelled' },
        },
      });

      if (!existingBooking) {
        timeSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }

      currentTime = slotEnd;
    }
  }

  return { timeSlots };
}

async function updateBookingDetails({ bookingId, timeSlotStart, fulfillmentType, userId }) {
  if (!bookingId || isNaN(parseInt(bookingId)) || !userId) {
    throw new Error('Invalid booking ID or user ID');
  }

  const booking = await prisma.booking.findFirst({
    where: { id: parseInt(bookingId), patientIdentifier: userId },
  });
  if (!booking) {
    throw new Error('Booking not found');
  }

  const updates = {};
  if (timeSlotStart) {
    const start = new Date(timeSlotStart);
    const end = new Date(start.getTime() + 30 * 60 * 1000); // 30-minute slot
    updates.timeSlotStart = start;
    updates.timeSlotEnd = end;
  }
  if (fulfillmentType) {
    if (!['Lab Visit', 'Home Collection'].includes(fulfillmentType)) {
      throw new Error('Invalid fulfillment type');
    }
    if (fulfillmentType === 'Home Collection') {
      const lab = await prisma.lab.findUnique({
        where: { id: booking.labId },
        select: { homeCollectionAvailable: true },
      });
      if (!lab?.homeCollectionAvailable) {
        throw new Error('Home collection not available for this lab');
      }
    }
    updates.fulfillmentType = fulfillmentType;
  }

  await prisma.booking.update({
    where: { id: parseInt(bookingId) },
    data: updates,
  });

  return { message: 'Booking details updated' };
}

module.exports = {
  addToBooking,
  getBooking,
  updateBookingItem,
  removeFromBooking,
  getTimeSlots,
  updateBookingDetails,
};