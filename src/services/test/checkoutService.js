const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('../../utils/validation');
const prisma = new PrismaClient();

async function initiateBookingCheckout({ name, email, phone, address, fulfillmentType, userId, file, timeSlotStart, timeSlotEnd }) {
  const patientIdentifier = userId;
  const normalizedPhone = normalizePhone(phone);

  // Find the booking
  const cartBooking = await prisma.booking.findFirst({
    where: { patientIdentifier, status: 'cart' },
    include: {
      BookingItem: {
        include: {
          LabTest: {
            include: { Test: true, Lab: true },
          },
        },
      },
    },
  });

  if (!cartBooking || cartBooking.BookingItem.length === 0) {
    throw new Error('Booking is empty or not found');
  }

  // Group items by lab
  const itemsByLab = cartBooking.BookingItem.reduce((acc, item) => {
    const labId = item.labTestLabId;
    if (!acc[labId]) {
      acc[labId] = { items: [], lab: item.LabTest.Lab };
    }
    acc[labId].items.push(item);
    return acc;
  }, {});

  const labIds = Object.keys(itemsByLab);
  const checkoutSessionId = uuidv4();

  // Validate availability and test order requirements
  let requiresTestOrder = false;
  for (const labId of labIds) {
    const { items } = itemsByLab[labId];
    for (const item of items) {
      if (!item.LabTest.available) {
        throw new Error(`Test ${item.LabTest.Test.name} is not available at ${item.LabTest.Lab.name}`);
      }
      if (item.LabTest.Test.orderRequired) {
        requiresTestOrder = true;
      }
    }
  }

  let verifiedTestOrder = null;
  let newTestOrder = null;

  if (requiresTestOrder) {
    verifiedTestOrder = await prisma.testOrder.findFirst({
      where: { patientIdentifier, status: 'verified' },
      include: { TestOrderTest: true },
      orderBy: [{ createdAt: 'desc' }],
    });

    const bookingTestIds = cartBooking.BookingItem
      .filter(item => item.LabTest.Test.orderRequired)
      .map(item => item.LabTest.testId);

    let isValidTestOrder = false;
    if (verifiedTestOrder) {
      const testOrderTestIds = verifiedTestOrder.TestOrderTest.map(tot => tot.testId);
      isValidTestOrder = bookingTestIds.every(id => testOrderTestIds.includes(id));
    }

    if (!isValidTestOrder) {
      if (file) {
        const fileUrl = `uploads/${file.filename}`;
        newTestOrder = await prisma.testOrder.create({
          data: {
            patientIdentifier,
            fileUrl,
            status: 'pending',
            verified: false,
            email,
            phone: normalizedPhone,
            createdAt: new Date().toISOString(),
          },
        });
        const uncoveredTestIds = verifiedTestOrder
          ? bookingTestIds.filter(id => !verifiedTestOrder.TestOrderTest.map(tot => tot.testId).includes(id))
          : bookingTestIds;
        const testOrderItems = uncoveredTestIds.map(testId => ({
          testOrderId: newTestOrder.id,
          testId,
        }));
        if (testOrderItems.length > 0) {
          await prisma.testOrderTest.createMany({ data: testOrderItems });
        }
      } else if (!verifiedTestOrder) {
        throw new Error('Test order file is required for one or more tests');
      } else {
        throw new Error('Existing test order does not cover all required tests, and no new test order uploaded');
      }
    }
  }

  const bookings = [];
  const paymentReferences = [];

  for (const labId of labIds) {
    const { items, lab } = itemsByLab[labId];
    const coveredItems = verifiedTestOrder
      ? items.filter(item => item.LabTest.Test.orderRequired &&
          verifiedTestOrder.TestOrderTest.map(tot => tot.testId).includes(item.LabTest.testId))
      : [];
    const uncoveredItems = newTestOrder
      ? items.filter(item => item.LabTest.Test.orderRequired &&
          !verifiedTestOrder?.TestOrderTest.map(tot => tot.testId).includes(item.LabTest.testId))
      : [];
    const nonOrderItems = items.filter(item => !item.LabTest.Test.orderRequired);

    if (coveredItems.length > 0) {
      const totalPrice = coveredItems.reduce((sum, item) => sum + item.price, 0);
      const bookingStatus = 'pending';
      const paymentReference = `booking_${uuidv4()}`;
      const booking = await prisma.$transaction(async (tx) => {
        const newBooking = await tx.booking.create({
          data: {
            patientIdentifier,
            labId: parseInt(labId),
            status: bookingStatus,
            fulfillmentType,
            address: fulfillmentType === 'Home Collection' ? address : null,
            email,
            phone: normalizedPhone,
            totalPrice,
            paymentReference,
            paymentStatus: 'pending',
            checkoutSessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            testOrderId: verifiedTestOrder.id,
            timeSlotStart: timeSlotStart ? new Date(timeSlotStart).toISOString() : null,
            timeSlotEnd: timeSlotEnd ? new Date(timeSlotEnd).toISOString() : null,
          },
        });

        for (const item of coveredItems) {
          await tx.bookingItem.create({
            data: {
              bookingId: newBooking.id,
              labTestLabId: item.labTestLabId,
              labTestTestId: item.LabTest.testId,
              price: item.price,
            },
          });
        }

        return newBooking;
      });
      bookings.push({ booking, lab, requiresTestOrder: true });
      paymentReferences.push(paymentReference);
    }

    if (uncoveredItems.length > 0) {
      const totalPrice = uncoveredItems.reduce((sum, item) => sum + item.price, 0);
      const bookingStatus = 'pending'; // Using 'pending' to indicate awaiting test order verification
      const paymentReference = `booking_${uuidv4()}`;
      const booking = await prisma.$transaction(async (tx) => {
        const newBooking = await tx.booking.create({
          data: {
            patientIdentifier,
            labId: parseInt(labId),
            status: bookingStatus,
            fulfillmentType,
            address: fulfillmentType === 'Home Collection' ? address : null,
            email,
            phone: normalizedPhone,
            totalPrice,
            paymentReference,
            paymentStatus: 'pending',
            checkoutSessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            testOrderId: newTestOrder.id,
            timeSlotStart: timeSlotStart ? new Date(timeSlotStart).toISOString() : null,
            timeSlotEnd: timeSlotEnd ? new Date(timeSlotEnd).toISOString() : null,
          },
        });

        for (const item of uncoveredItems) {
          await tx.bookingItem.create({
            data: {
              bookingId: newBooking.id,
              labTestLabId: item.labTestLabId,
              labTestTestId: item.LabTest.testId,
              price: item.price,
            },
          });
        }

        return newBooking;
      });
      bookings.push({ booking, lab, requiresTestOrder: true });
      paymentReferences.push(paymentReference);
    }

    if (nonOrderItems.length > 0) {
      const totalPrice = nonOrderItems.reduce((sum, item) => sum + item.price, 0);
      const bookingStatus = 'pending';
      const paymentReference = `booking_${uuidv4()}`;
      const booking = await prisma.$transaction(async (tx) => {
        const newBooking = await tx.booking.create({
          data: {
            patientIdentifier,
            labId: parseInt(labId),
            status: bookingStatus,
            fulfillmentType,
            address: fulfillmentType === 'Home Collection' ? address : null,
            email,
            phone: normalizedPhone,
            totalPrice,
            paymentReference,
            paymentStatus: 'pending',
            checkoutSessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            testOrderId: null,
            timeSlotStart: timeSlotStart ? new Date(timeSlotStart).toISOString() : null,
            timeSlotEnd: timeSlotEnd ? new Date(timeSlotEnd).toISOString() : null,
          },
        });

        for (const item of nonOrderItems) {
          await tx.bookingItem.create({
            data: {
              bookingId: newBooking.id,
              labTestLabId: item.labTestLabId,
              labTestTestId: item.LabTest.testId,
              price: item.price,
            },
          });
        }

        return newBooking;
      });
      bookings.push({ booking, lab, requiresTestOrder: false });
      paymentReferences.push(paymentReference);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.bookingItem.deleteMany({ where: { bookingId: cartBooking.id } });
    await tx.booking.delete({ where: { id: cartBooking.id } });
  });

  const payableBookings = bookings.filter(b => b.booking.status === 'pending');
  console.log('Payable bookings:', payableBookings.map(b => ({ bookingId: b.booking.id, lab: b.lab.name, totalPrice: b.booking.totalPrice })));

  if (payableBookings.length > 0) {
    const totalPayableAmount = payableBookings.reduce((sum, b) => sum + b.booking.totalPrice, 0) * 100;
    const transactionReference = `session_${checkoutSessionId}_${uuidv4()}`;

    console.log('Initiating Paystack for payable bookings:', { totalPayableAmount, transactionReference });

    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: totalPayableAmount,
        reference: transactionReference,
        callback_url: `${process.env.PAYSTACK_CALLBACK_URL}?session=${checkoutSessionId}`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!paystackResponse.data.status) {
      throw new Error('Failed to initialize payment: ' + JSON.stringify(paystackResponse.data));
    }

    await prisma.transactionReference.create({
      data: {
        transactionReference,
        orderReferences: paymentReferences,
        checkoutSessionId,
        createdAt: new Date().toISOString(),
      },
    });

    return {
      message: 'Booking checkout initiated for payable items',
      checkoutSessionId,
      transactionReference,
      paymentReferences,
      paymentUrl: paystackResponse.data.data.authorization_url,
      bookings: bookings.map(b => ({
        bookingId: b.booking.id,
        lab: b.lab.name,
        status: b.booking.status,
        totalPrice: b.booking.totalPrice,
        paymentReference: b.booking.paymentReference,
        testOrderId: b.booking.testOrderId,
      })),
    };
  }

  console.log('Returning test order-only response:', { checkoutSessionId });
  return {
    message: 'Test order submitted, awaiting verification',
    checkoutSessionId,
    bookings: bookings.map(b => ({
      bookingId: b.booking.id,
      lab: b.lab.name,
      status: b.booking.status,
      totalPrice: b.booking.totalPrice,
      testOrderId: b.booking.testOrderId,
    })),
  };
}

async function retrieveSession({ email, phone, checkoutSessionId }) {
  let guestId = null;

  if (checkoutSessionId) {
    console.log('Checking booking by checkoutSessionId:', checkoutSessionId);
    const booking = await prisma.booking.findFirst({
      where: { checkoutSessionId },
      select: { patientIdentifier: true },
    });
    if (booking) {
      guestId = booking.patientIdentifier;
      console.log('Found guestId by checkoutSessionId:', guestId);
    }
  } else if (email || phone) {
    const orConditions = [];
    if (email) orConditions.push({ email });
    if (phone) orConditions.push({ phone: normalizePhone(phone) });

    console.log('OR conditions:', JSON.stringify(orConditions));

    const bookingQuery = {
      where: { ...(orConditions.length > 0 && { OR: orConditions }) },
      select: { patientIdentifier: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    };
    const testOrderQuery = {
      where: { ...(orConditions.length > 0 && { OR: orConditions }) },
      select: { patientIdentifier: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    };

    console.log('Booking query:', JSON.stringify(bookingQuery));
    console.log('Test order query:', JSON.stringify(testOrderQuery));

    const [booking, testOrder] = await prisma.$transaction([
      prisma.booking.findFirst(bookingQuery),
      prisma.testOrder.findFirst(testOrderQuery),
    ]);

    console.log('Booking result:', booking);
    console.log('Test order result:', testOrder);

    if (booking && testOrder) {
      guestId = booking.createdAt > testOrder.createdAt ? booking.patientIdentifier : testOrder.patientIdentifier;
      console.log('Selected guestId (booking vs test order):', guestId);
    } else {
      guestId = booking?.patientIdentifier || testOrder?.patientIdentifier;
      console.log('Selected guestId (single result):', guestId);
    }
  }

  if (!guestId) {
    throw new Error('Session not found');
  }

  return guestId;
}

async function validateTestOrder({ patientIdentifier, testIds }) {
  if (!patientIdentifier) {
    throw new Error('patientIdentifier required');
  }
  if (!testIds) {
    return false; // No test IDs means no test order required
  }
  const ids = testIds.split(',').map(Number).filter(id => !isNaN(id));
  if (ids.length === 0) {
    return false; // Invalid or empty IDs means no test order required
  }
  const testOrders = await prisma.testOrder.findMany({
    where: { patientIdentifier, status: 'verified' },
    include: { TestOrderTest: true },
  });
  if (!testOrders.length) {
    return true; // No verified test orders means upload is required
  }
  const testOrderTestIds = testOrders
    .flatMap(testOrder => testOrder.TestOrderTest.map(tot => tot.testId));
  console.log('Test order test IDs:', testOrderTestIds);
  return !ids.every(id => testOrderTestIds.includes(id)); // Upload required if any ID is not covered
}

async function getSessionDetails({ bookingId, userId }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      checkoutSessionId: true,
      patientIdentifier: true,
      email: true,
      testOrderId: true,
    },
  });

  if (!booking || booking.patientIdentifier !== userId || !booking.testOrderId) {
    throw new Error('Booking not found, unauthorized, or not linked to a test order');
  }

  const testOrder = await prisma.testOrder.findUnique({
    where: { id: booking.testOrderId },
    select: { patientIdentifier: true },
  });

  if (!testOrder || testOrder.patientIdentifier !== userId) {
    throw new Error('Test order not found or not linked to the same patient');
  }

  const sessionBookings = await prisma.booking.findMany({
    where: {
      checkoutSessionId: booking.checkoutSessionId,
      patientIdentifier: userId,
      testOrderId: { not: null },
      testOrder: { patientIdentifier: userId },
    },
    select: {
      id: true,
      totalPrice: true,
      status: true,
      testOrderId: true,
    },
  });

  if (sessionBookings.length === 0) {
    throw new Error('No bookings found in this session with a valid test order');
  }

  const totalAmount = sessionBookings
    .filter(b => b.status === 'pending')
    .reduce((sum, b) => sum + b.totalPrice, 0);

  console.log('Session details retrieved:', { bookingId, userId, checkoutSessionId: booking.checkoutSessionId, totalAmount });

  return {
    message: 'Session details retrieved',
    checkoutSessionId: booking.checkoutSessionId,
    totalAmount,
    email: booking.email || null,
    bookings: sessionBookings.map(b => ({
      bookingId: b.id,
      totalPrice: b.totalPrice,
      status: b.status,
      testOrderId: b.testOrderId,
    })),
  };
}

async function resumeBookingCheckout({ bookingId, email, userId }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      BookingItem: {
        include: {
          LabTest: {
            include: { Test: true },
          },
        },
      },
      TestOrder: true,
    },
  });

  if (!booking || booking.patientIdentifier !== userId) {
    throw new Error('Booking not found or unauthorized');
  }

  const sessionBookings = await prisma.booking.findMany({
    where: {
      checkoutSessionId: booking.checkoutSessionId,
      patientIdentifier: userId,
      status: 'pending',
    },
    include: {
      BookingItem: {
        include: {
          LabTest: {
            include: { Test: true },
          },
        },
      },
      TestOrder: true,
    },
  });

  if (sessionBookings.length === 0) {
    throw new Error('No bookings awaiting payment in this session');
  }

  for (const sessionBooking of sessionBookings) {
    const requiresTestOrder = sessionBooking.BookingItem.some(
      item => item.LabTest.Test.orderRequired
    );
    if (requiresTestOrder && (!sessionBooking.TestOrder || sessionBooking.TestOrder.status !== 'verified')) {
      throw new Error(`Test order not verified for booking ${sessionBooking.id}`);
    }
  }

  const totalAmount = sessionBookings.reduce((sum, b) => sum + b.totalPrice, 0) * 100;
  if (totalAmount <= 0) {
    throw new Error('Invalid booking amount');
  }

  const transactionReference = `session_${booking.checkoutSessionId}_${uuidv4()}`;
  const paymentReferences = [];

  const paystackResponse = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email,
      amount: totalAmount,
      reference: transactionReference,
      callback_url: `${process.env.PAYSTACK_CALLBACK_URL}?session=${booking.checkoutSessionId}`,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!paystackResponse.data.status) {
    throw new Error('Failed to initialize payment: ' + JSON.stringify(paystackResponse.data));
  }

  await prisma.$transaction(async (tx) => {
    for (const sessionBooking of sessionBookings) {
      const bookingSpecificReference = `booking_${sessionBooking.id}_${uuidv4()}`;
      await tx.booking.update({
        where: { id: sessionBooking.id },
        data: {
          paymentReference: bookingSpecificReference,
          paymentStatus: 'pending',
          updatedAt: new Date().toISOString(),
        },
      });
      paymentReferences.push(bookingSpecificReference);
    }
    await tx.transactionReference.create({
      data: {
        transactionReference,
        orderReferences: paymentReferences,
        checkoutSessionId: booking.checkoutSessionId,
        createdAt: new Date().toISOString(),
      },
    });
  });

  console.log('Booking checkout resumed for session:', { bookingId, userId, checkoutSessionId: booking.checkoutSessionId, totalAmount, transactionReference, paymentReferences });

  return {
    message: 'Booking checkout resumed for session',
    checkoutSessionId: booking.checkoutSessionId,
    transactionReference,
    paymentReferences,
    paymentUrl: paystackResponse.data.data.authorization_url,
    totalAmount: totalAmount / 100,
    bookings: sessionBookings.map(b => ({
      bookingId: b.id,
      totalPrice: b.totalPrice,
      status: b.status,
      paymentReference: b.paymentReference,
    })),
  };
}

async function getResumeBookings({ bookingId, userId }) {
  const initialBooking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { checkoutSessionId: true, patientIdentifier: true, testOrderId: true, status: true },
  });

  if (!initialBooking || initialBooking.patientIdentifier !== userId || !initialBooking.testOrderId || initialBooking.status !== 'pending') {
    throw new Error('Booking not found, unauthorized, not linked to a test order, or not pending');
  }

  const bookings = await prisma.booking.findMany({
    where: {
      checkoutSessionId: initialBooking.checkoutSessionId,
      patientIdentifier: userId,
      testOrderId: initialBooking.testOrderId,
      status: 'pending',
    },
    include: {
      BookingItem: {
        include: {
          LabTest: { include: { Test: true, Lab: true } },
        },
      },
      TestOrder: true,
      Lab: true,
    },
  });

  if (!bookings.length) {
    throw new Error('No pending bookings found for this session');
  }

  const labs = bookings.reduce((acc, booking) => {
    const labId = booking.labId;
    const existing = acc.find(l => l.lab.id === labId);
    const bookingData = {
      id: booking.id,
      totalPrice: booking.totalPrice,
      status: booking.status,
      email: booking.email || null,
      testOrder: booking.TestOrder
        ? { id: booking.TestOrder.id, status: booking.TestOrder.status, uploadedAt: booking.TestOrder.createdAt }
        : null,
      items: booking.BookingItem.map(item => ({
        id: item.id,
        price: item.price,
        test: { id: item.LabTest.Test.id, name: item.LabTest.Test.name },
      })),
    };

    if (existing) {
      existing.bookings.push(bookingData);
    } else {
      acc.push({
        lab: { id: booking.Lab.id, name: booking.Lab.name, address: booking.Lab.address },
        bookings: [bookingData],
      });
    }
    return acc;
  }, []);

  return {
    labs,
    trackingCode: bookings[0].trackingCode || 'Pending',
  };
}

module.exports = {
  initiateBookingCheckout,
  retrieveSession,
  validateTestOrder,
  getSessionDetails,
  resumeBookingCheckout,
  getResumeBookings,
};