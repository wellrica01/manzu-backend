const { PrismaClient } = require('@prisma/client');
const { normalizePhone } = require('../../utils/validation');
const { sendVerificationNotification } = require('../../utils/notifications');
const { formatDisplayName } = require('../../utils/lab/testUtils');
const prisma = new PrismaClient();

async function uploadTestOrder({ patientIdentifier, email, phone, fileUrl }) {
  const normalizedPhone = phone ? normalizePhone(phone) : phone;
  const testOrder = await prisma.testOrder.create({
    data: {
      patientIdentifier,
      email,
      phone: normalizedPhone,
      fileUrl,
      status: 'pending',
      verified: false,
    },
  });
  console.log('Test order uploaded:', { testOrderId: testOrder.id });
  return testOrder;
}

async function addTests(testOrderId, tests) {
  const testOrder = await prisma.testOrder.findUnique({
    where: { id: testOrderId },
  });
  if (!testOrder) {
    throw new Error('Order not found');
  }
  if (testOrder.status !== 'pending') {
    throw new Error('Test order is already processed');
  }

  const result = await prisma.$transaction(async (tx) => {
    const testOrderTests = [];
    for (const test of tests) {
      const { testId, quantity } = test;
      const test = await tx.test.findUnique({
        where: { id: Number(testId) },
      });
      if (!test) {
        throw new Error(`Test ${testId} not found`);
      }
      const testOrderTest = await tx.testOrderTest.create({
        data: {
          testOrderId,
          testId: Number(testId),
          quantity,
        },
      });
      testOrderTests.push(testOrderTest);
    };
    return { testOrderTests };
  });

  console.log('Tests added:', { testOrderId });
  return result;
}

async function verifyTestOrder(testOrderId, status) {
  const testOrder = await prisma.testOrder.findUnique({
    where: { id: testOrderId },
    include: {
      bookings: [{
        include: { 
          items: true,
          lab: true,
        },
      }],
    },
  });
  if (!testOrder) {
    throw new Error('Test order not found');
  }
  const updatedOrder = await prisma.$transaction(async (tx) => {
    const testOrderUpdate = await tx.testOrder.update({
      where: { id: testOrderId },
      data: {
        status,
        verified: status === 'verified',
      },
    });

    if (testOrder.bookings && testOrder.bookings.length > 0) {
      if (status === 'rejected') {
        for (const booking of testOrder.bookings) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: 'cancelled',
              cancelReason: 'Test order rejected',
              cancelledAt: true,
            },
          });
        }
      } else if (status === 'verified') {
        for (const booking of testOrder.bookings) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: 'pending',
            },
          });
        }
      }
    }

    return testOrderUpdate;
  });

  if (testOrder.bookings && testOrder.bookings.length > 0) {
    for (const booking of testOrder.bookings) {
      await sendVerificationNotification(testOrder, status, booking);
    }
  }

  console.log('Test order updated:', { testOrderId: updatedOrder.id, status });
  return updatedOrder;
}

async function getGuestTestOrder({ patientIdentifier, lat, lng, radius }) {
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radiusKm = parseFloat(radius);
  const hasValidCoordinates = lat && lng && !isNaN(userLat) && !isNaN(userLng) && !isNaN(radiusKm);

  if (hasValidCoordinates && (userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180)) {
    throw new Error('Invalid latitude or longitude');
  }

  const testOrder = await prisma.testOrder.findFirst({
    where: { patientIdentifier, status: { in: ['pending', 'verified'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      TestOrderTest: {
        include: {
          Test: {
            select: { id: true, name: true, testType: true, testCode: true, imageUrl: true, orderRequired: true },
          },
        },
      },
    },
  });

  if (!testOrder) {
    throw new Error('Test order not found or not verified');
  }

  // For pending test orders, return metadata without tests or booking details
  if (testOrder.status === 'pending') {
    return {
      tests: [],
      testOrderId: testOrder.id,
      bookingId: null,
      bookingStatus: null,
      testOrderMetadata: {
        id: testOrder.id,
        uploadedAt: testOrder.createdAt,
        status: testOrder.status,
        fileUrl: testOrder.fileUrl,
      },
    }
  }

  let labIdsWithDistance = [];
  if (hasValidCoordinates) {
    labIdsWithDistance = await prisma.$queryRaw`
      SELECT 
        id,
        ST_DistanceSphere(
          location,
          ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326)
        ) / 1000 AS distance_km
      FROM "Lab"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${userLat}, ${userLng}), 4326),
        ${radiusKm} * 1000
      )
      AND status = 'verified'
      AND "isActive" = true
    `.then(results =>
      results.map(l => ({
        id: Number(l.id),
        distance_km: parseFloat(l.distance_km.toFixed(2)),
      }))
    );
  }

  const distanceMap = new Map(
    labIdsWithDistance.map(l => [l.id, l.distance_km])
  );

  const tests = await Promise.all(
    testOrder.TestOrderTest.map(async testOrderItem => {
      const test = testOrderItem.Test;
      const availability = await prisma.labTest.findMany({
        where: {
          testId: test.id,
          available: true,
          lab: {
            status: 'verified',
            isActive: true,
            ...(hasValidCoordinates && {
              id: {
                in: labIdsWithDistance.length > 0
                  ? labIdsWithDistance.map(l => l.id)
                  : [-1],
              },
            }),
          },
        },
        include: {
          lab: { select: { id: true, name: true, address: true } },
        },
      });

      return {
        id: test.id,
        displayName: formatDisplayName(test),
        quantity: testOrderItem.quantity,
        testType: test.testType,
        orderRequired: test.orderRequired,
        testCode: test.testCode,
        imageUrl: test.imageUrl,
        availability: availability.map(avail => ({
          labId: avail.lab.id,
          labName: avail.lab.name,
          address: avail.lab.address,
          price: avail.price,
          distance_km: distanceMap.has(avail.lab.id)
            ? distanceMap.get(avail.lab.id)
            : null,
        })),
      };
    })
  );

  const booking = await prisma.booking.findFirst({
    where: {
      patientIdentifier,
      testOrderId: testOrder.id,
      status: { in: ['pending', 'confirmed', 'processing', 'delivered', 'ready_for_pickup', 'cancelled'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    tests,
    testOrderId: testOrder.id,
    bookingId: booking?.id,
    bookingStatus: booking?.status,
    testOrderMetadata: {
      id: testOrder.id,
      uploadedAt: testOrder.createdAt,
      status: testOrder.status,
      fileUrl: testOrder.fileUrl,
    },
  };
}

async function getTestOrderStatuses({ patientIdentifier, testIds }) {
  try {
    // Validate testIds
    const validTestIds = testIds.filter(id => id && !isNaN(parseInt(id))).map(id => id.toString());
    if (validTestIds.length === 0) {
      console.warn('No valid test IDs provided:', { patientIdentifier, testIds });
      return Object.fromEntries(testIds.map(id => [id, 'none']));
    }

    // Fetch the latest test order for the patient
    const testOrder = await prisma.testOrder.findFirst({
      where: { 
        patientIdentifier, 
        status: { in: ['pending', 'verified'] } 
      },
      orderBy: { createdAt: 'desc' },
      include: {
        TestOrderTest: {
          include: {
            Test: {
              select: { id: true },
            },
          },
        },
      },
    });

    // Initialize statuses as 'none' for all requested testIds
    const statuses = Object.fromEntries(
      validTestIds.map(id => [id, 'none'])
    );

    if (!testOrder) {
      console.log('No test order found for patient:', { patientIdentifier });
      return statuses;
    }

    // Map testIds covered by the test order
    const coveredTestIds = testOrder.TestOrderTest
      .map(tot => tot.testId.toString());

    for (const testId of validTestIds) {
      if (coveredTestIds.includes(testId)) {
        statuses[testId] = testOrder.status; // 'verified' or 'pending'
      }
    }

    console.log('Test order statuses retrieved:', { patientIdentifier, statuses });
    return statuses;
  } catch (error) {
    console.error('Error fetching test order statuses:', error);
    throw new Error('Failed to fetch test order statuses');
  }
}

module.exports = { uploadTestOrder, addTests, verifyTestOrder, getGuestTestOrder, getTestOrderStatuses };