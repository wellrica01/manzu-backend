const { PrismaClient } = require('@prisma/client');
const { normalizePhone } = require('../../utils/validation');
const { sendVerificationNotification } = require('../../utils/notifications');
const { formatDisplayName } = require('../../utils/test/testUtils');
const prisma = new PrismaClient();

async function uploadTestOrder({ patientIdentifier, email, phone, fileUrl }) {
  if (!patientIdentifier || !fileUrl) {
    throw new Error('Patient identifier and file URL are required');
  }

  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const testOrder = await prisma.testOrder.create({
    data: {
      patientIdentifier,
      email,
      phone: normalizedPhone,
      fileUrl,
      status: 'pending',
      verified: false,
      createdAt: new Date().toISOString(),
    },
  });
  console.log('Test order uploaded:', { testOrderId: testOrder.id });
  return testOrder;
}

async function addTests(testOrderId, tests) {
  if (!testOrderId || isNaN(parseInt(testOrderId)) || !Array.isArray(tests) || tests.length === 0) {
    throw new Error('Invalid test order ID or tests array');
  }

  const testOrder = await prisma.testOrder.findUnique({
    where: { id: parseInt(testOrderId) },
  });
  if (!testOrder) {
    throw new Error('Test order not found');
  }
  if (testOrder.status !== 'pending') {
    throw new Error('Test order is already processed');
  }

  const result = await prisma.$transaction(async (tx) => {
    const testOrderTests = [];
    for (const test of tests) {
      const { testId } = test;
      if (!testId || isNaN(parseInt(testId))) {
        throw new Error(`Invalid test ID: ${testId}`);
      }
      const testRecord = await tx.test.findUnique({
        where: { id: parseInt(testId) },
      });
      if (!testRecord) {
        throw new Error(`Test ${testId} not found`);
      }
      const testOrderTest = await tx.testOrderTest.create({
        data: {
          testOrderId: parseInt(testOrderId),
          testId: parseInt(testId),
        },
      });
      testOrderTests.push(testOrderTest);
    }
    return { testOrderTests };
  });

  console.log('Tests added:', { testOrderId });
  return result;
}

async function verifyTestOrder(testOrderId, status) {
  if (!testOrderId || isNaN(parseInt(testOrderId))) {
    throw new Error('Invalid test order ID');
  }
  if (!['pending', 'verified', 'rejected'].includes(status)) {
    throw new Error('Invalid status value');
  }

  const testOrder = await prisma.testOrder.findUnique({
    where: { id: parseInt(testOrderId) },
    include: {
      Booking: {
        include: {
          BookingItem: true,
          Lab: true,
        },
      },
    },
  });
  if (!testOrder) {
    throw new Error('Test order not found');
  }

  const updatedOrder = await prisma.$transaction(async (tx) => {
    const testOrderUpdate = await tx.testOrder.update({
      where: { id: parseInt(testOrderId) },
      data: {
        status,
        verified: status === 'verified',
        updatedAt: new Date().toISOString(),
      },
    });

    if (testOrder.Booking && testOrder.Booking.length > 0) {
      if (status === 'rejected') {
        for (const booking of testOrder.Booking) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: 'cancelled',
              cancelReason: 'Test order rejected',
              cancelledAt: new Date().toISOString(),
            },
          });
        }
      } else if (status === 'verified') {
        for (const booking of testOrder.Booking) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: 'confirmed',
            },
          });
        }
      }
    }

    return testOrderUpdate;
  });

  if (testOrder.Booking && testOrder.Booking.length > 0) {
    for (const booking of testOrder.Booking) {
      await sendVerificationNotification(testOrder, status, booking);
    }
  }

  console.log('Test order updated:', { testOrderId: updatedOrder.id, status });
  return updatedOrder;
}

async function getGuestTestOrder({ patientIdentifier, lat, lng, radius }) {
  if (!patientIdentifier) {
    throw new Error('Patient identifier is required');
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radiusKm = parseFloat(radius) || 10;
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
    };
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
        ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326),
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
          Lab: {
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
          Lab: { select: { id: true, name: true, address: true } },
        },
      });

      return {
        id: test.id,
        displayName: formatDisplayName(test),
        testType: test.testType,
        orderRequired: test.orderRequired,
        testCode: test.testCode,
        imageUrl: test.imageUrl,
        availability: availability.map(avail => ({
          labId: avail.Lab.id,
          labName: avail.Lab.name,
          address: avail.Lab.address,
          price: avail.price,
          distance_km: distanceMap.has(avail.Lab.id)
            ? distanceMap.get(avail.Lab.id)
            : null,
        })),
      };
    })
  );

  const booking = await prisma.booking.findFirst({
    where: {
      patientIdentifier,
      testOrderId: testOrder.id,
      status: { in: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled', 'sample_collected', 'result_ready', 'completed'] },
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
  if (!patientIdentifier) {
    throw new Error('Patient identifier is required');
  }

  try {
    // Validate testIds
    const validTestIds = testIds
      .filter(id => id && !isNaN(parseInt(id)))
      .map(id => parseInt(id).toString());
    if (validTestIds.length === 0) {
      console.warn('No valid test IDs provided:', { patientIdentifier, testIds });
      return Object.fromEntries(testIds.map(id => [id, 'none']));
    }

    // Fetch the latest test order for the patient
    const testOrder = await prisma.testOrder.findFirst({
      where: {
        patientIdentifier,
        status: { in: ['pending', 'verified'] },
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