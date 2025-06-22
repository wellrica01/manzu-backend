const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fetchBookings(labId) {
  const bookings = await prisma.booking.findMany({
    where: {
      items: {
        some: {
          labTest: {
            labId,
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
      deliveryMethod: true,
      address: true,
      status: true,
      totalPrice: true,
      items: {
        select: {
          id: true,
          price: true,
          labTest: {
            select: {
              test: { select: { name: true } },
              lab: { select: { name: true, address: true } },
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
    deliveryMethod: booking.deliveryMethod,
    address: booking.address,
    status: booking.status,
    totalPrice: booking.totalPrice,
    items: booking.items
      .filter(item => item.labTest.labId === labId)
      .map(item => ({
        id: item.id,
        test: { name: item.labTest.test.name },
        lab: {
          name: item.labTest.lab.name,
          address: item.labTest.lab.address,
        },
        price: item.price,
      })),
  }));
}

async function updateBookingStatus(bookingId, status, labId) {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      items: {
        some: {
          labTest: {
            labId,
          },
        },
      },
    },
  });
  if (!booking) {
    throw new Error('Booking not found for lab');
  }

  const updateData = { status };
  if (status === 'completed' || status === 'scheduled') {
    updateData.filledAt = new Date();
  }

  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: updateData,
  });

  console.log('Booking status updated:', { bookingId, status: updatedBooking.status, filledAt: updatedBooking.filledAt });
  return updatedBooking;
}

async function fetchTests(labId) {
  const tests = await prisma.labTest.findMany({
    where: { labId },
    include: { test: true },
  });
  const allTests = await prisma.test.findMany();

  return {
    tests: tests.map(t => ({
      labId: t.labId,
      testId: t.testId,
      name: t.test.name,
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
  const existing = await prisma.labTest.findUnique({
    where: { labId_testId: { labId, testId } },
  });
  if (existing) {
    throw new Error('Test already exists in lab inventory');
  }

  const test = await prisma.labTest.create({
    data: {
      labId,
      testId,
      price,
      available,
    },
    include: { test: true },
  });

  console.log('Test added:', { labId: test.labId, testId: test.testId });
  return {
    labId: test.labId,
    testId: test.testId,
    name: test.test.name,
    price: test.price,
    available: test.available,
  };
}

async function updateTest({ labId, testId, price, available }) {
  const test = await prisma.labTest.findUnique({
    where: { labId_testId: { labId, testId } },
    include: { test: true },
  });
  if (!test) {
    throw new Error('Test not found');
  }

  const updatedTest = await prisma.labTest.update({
    where: { labId_testId: { labId, testId } },
    data: {
      price,
      available,
    },
    include: { test: true },
  });

  console.log('Test updated:', { labId: updatedTest.labId, testId: updatedTest.testId });
  return {
    labId: updatedTest.labId,
    testId: updatedTest.testId,
    name: updatedTest.test.name,
    price: updatedTest.price,
    available: updatedTest.available,
  };
}

async function deleteTest(labId, testId) {
  const test = await prisma.labTest.findUnique({
    where: { labId_testId: { labId, testId } },
  });
  if (!test) {
    throw new Error('Test not found');
  }

  await prisma.labTest.delete({
    where: { labId_testId: { labId, testId } },
  });

  console.log('Test deleted:', { labId, testId });
}

async function fetchUsers(labId) {
  const users = await prisma.labUser.findMany({
    where: { labId },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log('Users fetched:', { labId, userCount: users.length });
  return users;
}

async function registerDevice(labId, deviceToken) {
  await prisma.lab.update({
    where: { id: labId },
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