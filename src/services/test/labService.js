const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fetchBookings(labId) {
  if (!labId || isNaN(parseInt(labId))) {
    throw new Error('Invalid lab ID');
  }

  const bookings = await prisma.booking.findMany({
    where: {
      BookingItem: {
        some: {
          LabTest: {
            labId: parseInt(labId),
          },
        },
      },
      status: { not: 'cart' },
    },
    select: {
      id: true,
      createdAt: true,
      trackingCode: true,
      patientIdentifier: true,
      fulfillmentType: true,
      address: true,
      status: true,
      totalPrice: true,
      BookingItem: {
        select: {
          id: true,
          price: true,
          LabTest: {
            select: {
              Test: { select: { name: true } },
              Lab: { select: { name: true, address: true } },
              labId: true,
            },
          },
        },
      },
    },
  });

  return bookings.map(booking => ({
    id: booking.id,
    createdAt: booking.createdAt,
    trackingCode: booking.trackingCode,
    patientIdentifier: booking.patientIdentifier,
    fulfillmentType: booking.fulfillmentType,
    address: booking.address,
    status: booking.status,
    totalPrice: booking.totalPrice,
    items: booking.BookingItem
      .filter(item => item.LabTest.labId === parseInt(labId))
      .map(item => ({
        id: item.id,
        test: { name: item.LabTest.Test.name },
        lab: {
          name: item.LabTest.Lab.name,
          address: item.LabTest.Lab.address,
        },
        price: item.price,
      })),
  }));
}

async function updateBookingStatus(bookingId, status, labId) {
  if (!bookingId || isNaN(parseInt(bookingId)) || !labId || isNaN(parseInt(labId))) {
    throw new Error('Invalid booking or lab ID');
  }

  const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled', 'sample_collected', 'result_ready', 'completed'];
  if (!validStatuses.includes(status)) {
    throw new Error('Invalid status value');
  }

  const booking = await prisma.booking.findFirst({
    where: {
      id: parseInt(bookingId),
      BookingItem: {
        some: {
          LabTest: {
            labId: parseInt(labId),
          },
        },
      },
    },
  });
  if (!booking) {
    throw new Error('Booking not found for lab');
  }

  const updateData = { status };
  if (status === 'completed') {
    updateData.filledAt = new Date().toISOString();
  }

  const updatedBooking = await prisma.booking.update({
    where: { id: parseInt(bookingId) },
    data: updateData,
  });

  console.log('Booking status updated:', { bookingId, status: updatedBooking.status, filledAt: updatedBooking.filledAt });
  return updatedBooking;
}

async function fetchTests(labId) {
  if (!labId || isNaN(parseInt(labId))) {
    throw new Error('Invalid lab ID');
  }

  const tests = await prisma.labTest.findMany({
    where: { labId: parseInt(labId) },
    include: { Test: true },
  });
  const allTests = await prisma.test.findMany();

  return {
    tests: tests.map(t => ({
      labId: t.labId,
      testId: t.testId,
      name: t.Test.name,
      price: t.price,
      available: t.available,
    })),
    availableTests: allTests.map(t => ({
      id: t.id,
      name: t.name,
    })),
  };
}

async function addTest({ labId, testId, price, available }) {
  if (!labId || isNaN(parseInt(labId)) || !testId || isNaN(parseInt(testId))) {
    throw new Error('Invalid lab or test ID');
  }
  if (isNaN(parseFloat(price)) || price < 0) {
    throw new Error('Invalid price');
  }

  const existing = await prisma.labTest.findUnique({
    where: { labId_testId: { labId: parseInt(labId), testId: parseInt(testId) } },
  });
  if (existing) {
    throw new Error('Test already exists in lab inventory');
  }

  const test = await prisma.labTest.create({
    data: {
      labId: parseInt(labId),
      testId: parseInt(testId),
      price: parseFloat(price),
      available: Boolean(available),
    },
    include: { Test: true },
  });

  console.log('Test added:', { labId: test.labId, testId: test.testId });
  return {
    labId: test.labId,
    testId: test.testId,
    name: test.Test.name,
    price: test.price,
    available: test.available,
  };
}

async function updateTest({ labId, testId, price, available }) {
  if (!labId || isNaN(parseInt(labId)) || !testId || isNaN(parseInt(testId))) {
    throw new Error('Invalid lab or test ID');
  }
  if (isNaN(parseFloat(price)) || price < 0) {
    throw new Error('Invalid price');
  }

  const test = await prisma.labTest.findUnique({
    where: { labId_testId: { labId: parseInt(labId), testId: parseInt(testId) } },
    include: { Test: true },
  });
  if (!test) {
    throw new Error('Test not found');
  }

  const updatedTest = await prisma.labTest.update({
    where: { labId_testId: { labId: parseInt(labId), testId: parseInt(testId) } },
    data: {
      price: parseFloat(price),
      available: Boolean(available),
    },
    include: { Test: true },
  });

  console.log('Test updated:', { labId: updatedTest.labId, testId: updatedTest.testId });
  return {
    labId: updatedTest.labId,
    testId: updatedTest.testId,
    name: updatedTest.Test.name,
    price: updatedTest.price,
    available: updatedTest.available,
  };
}

async function deleteTest(labId, testId) {
  if (!labId || isNaN(parseInt(labId)) || !testId || isNaN(parseInt(testId))) {
    throw new Error('Invalid lab or test ID');
  }

  const test = await prisma.labTest.findUnique({
    where: { labId_testId: { labId: parseInt(labId), testId: parseInt(testId) } },
  });
  if (!test) {
    throw new Error('Test not found');
  }

  await prisma.labTest.delete({
    where: { labId_testId: { labId: parseInt(labId), testId: parseInt(testId) } },
  });

  console.log('Test deleted:', { labId, testId });
}

async function fetchUsers(labId) {
  if (!labId || isNaN(parseInt(labId))) {
    throw new Error('Invalid lab ID');
  }

  const users = await prisma.labUser.findMany({
    where: { labId: parseInt(labId) },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log('Users fetched:', { labId, userCount: users.length });
  return users;
}

async function registerDevice(labId, deviceToken) {
  if (!labId || isNaN(parseInt(labId)) || !deviceToken) {
    throw new Error('Invalid lab ID or device token');
  }

  await prisma.lab.update({
    where: { id: parseInt(labId) },
    data: { deviceToken },
  });
  console.log('Device registered:', { labId });
}

module.exports = {
  fetchBookings,
  updateBookingStatus,
  fetchTests,
  addTest,
  updateTest,
  deleteTest,
  fetchUsers,
  registerDevice,
};