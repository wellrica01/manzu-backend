const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('../utils/validation');
const { recalculateOrderTotal } = require('../utils/orderUtils');
const prisma = new PrismaClient();

async function initiateCheckout({ name, email, phone, address, deliveryMethod, userId, file, timeSlotStart, timeSlotEnd }) {
  const patientIdentifier = userId;
  const normalizedPhone = normalizePhone(phone);

  // Find the cart order
  const cartOrder = await prisma.order.findFirst({
    where: { patientIdentifier, status: 'cart' },
    include: {
      items: {
        include: {
          providerService: {
            include: { service: true, provider: true },
          },
        },
      },
    },
  });

  if (!cartOrder || cartOrder.items.length === 0) {
    throw new Error('Cart is empty or not found');
  }

  // Group items by provider
  const itemsByProvider = cartOrder.items.reduce((acc, item) => {
    const providerId = item.providerService.providerId;
    if (!acc[providerId]) {
      acc[providerId] = { items: [], provider: item.providerService.provider };
    }
    acc[providerId].items.push(item);
    return acc;
  }, {});

  const providerIds = Object.keys(itemsByProvider);
  const checkoutSessionId = uuidv4();

  // Validate stock/availability and prescription requirements
  let requiresPrescription = false;
  for (const providerId of providerIds) {
    const { items } = itemsByProvider[providerId];
    for (const item of items) {
      const service = item.providerService.service;
      if (service.type === 'medication' && item.providerService.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${service.name}`);
      }
      if (service.type === 'diagnostic' && !item.providerService.available) {
        throw new Error(`Service ${service.name} is not available at ${item.providerService.provider.name}`);
      }
      if (service.prescriptionRequired) {
        requiresPrescription = true;
      }
    }
  }

  let verifiedPrescription = null;
  let newPrescription = null;

  if (requiresPrescription) {
    verifiedPrescription = await prisma.prescription.findFirst({
      where: { patientIdentifier, status: 'verified' },
      include: { prescriptionServices: true },
      orderBy: [{ createdAt: 'desc' }],
    });

    const orderServiceIds = cartOrder.items
      .filter(item => item.providerService.service.prescriptionRequired)
      .map(item => item.providerService.serviceId);

    let isValidPrescription = false;
    if (verifiedPrescription) {
      const prescriptionServiceIds = verifiedPrescription.prescriptionServices.map(ps => ps.serviceId);
      isValidPrescription = orderServiceIds.every(id => prescriptionServiceIds.includes(id));
    }

    if (!isValidPrescription) {
      if (file) {
        const fileUrl = `uploads/${file.filename}`;
        newPrescription = await prisma.prescription.create({
          data: {
            patientIdentifier,
            fileUrl,
            status: 'pending',
            verified: false,
            email,
            phone: normalizedPhone,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        const uncoveredServiceIds = verifiedPrescription
          ? orderServiceIds.filter(id => !verifiedPrescription.prescriptionServices.map(ps => ps.serviceId).includes(id))
          : orderServiceIds;
        const prescriptionItems = uncoveredServiceIds.map(serviceId => ({
          prescriptionId: newPrescription.id,
          serviceId,
          quantity: cartOrder.items.find(item => item.providerService.serviceId === serviceId)?.quantity || 1,
        }));
        if (prescriptionItems.length > 0) {
          await prisma.prescriptionService.createMany({ data: prescriptionItems });
        }
      } else if (!verifiedPrescription) {
        throw new Error('Prescription file is required for one or more services');
      } else {
        throw new Error('Existing prescription does not cover all required services, and no new prescription uploaded');
      }
    }
  }

  const orders = [];
  const paymentReferences = [];

  for (const providerId of providerIds) {
    const { items, provider } = itemsByProvider[providerId];
    const coveredItems = verifiedPrescription
      ? items.filter(item => item.providerService.service.prescriptionRequired &&
          verifiedPrescription.prescriptionServices.map(ps => ps.serviceId).includes(item.providerService.serviceId))
      : [];
    const uncoveredItems = newPrescription
      ? items.filter(item => item.providerService.service.prescriptionRequired &&
          !verifiedPrescription?.prescriptionServices.map(ps => ps.serviceId).includes(item.providerService.serviceId))
      : [];
    const nonPrescriptionItems = items.filter(item => !item.providerService.service.prescriptionRequired);

    if (coveredItems.length > 0) {
      const totalPrice = await recalculateOrderTotal(coveredItems);
      const orderStatus = 'pending';
      const paymentReference = `order_${Date.now()}_${providerId}_verified`;
      const order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            patientIdentifier,
            providerId: parseInt(providerId),
            status: orderStatus,
            deliveryMethod,
            address: deliveryMethod === 'delivery' ? address : null,
            email,
            phone: normalizedPhone,
            totalPrice,
            paymentReference,
            paymentStatus: 'pending',
            checkoutSessionId,
            createdAt: new Date(),
            updatedAt: new Date(),
            prescriptionId: verifiedPrescription.id,
            timeSlotStart: timeSlotStart ? new Date(timeSlotStart) : null,
            timeSlotEnd: timeSlotEnd ? new Date(timeSlotEnd) : null,
          },
        });

        for (const item of coveredItems) {
          await tx.orderItem.create({
            data: {
              orderId: newOrder.id,
              providerId: item.providerService.providerId,
              serviceId: item.providerService.serviceId,
              quantity: item.quantity,
              price: item.price,
            },
          });

          if (item.providerService.service.type === 'medication') {
            await tx.providerService.update({
              where: {
                providerId_serviceId: {
                  providerId: item.providerService.providerId,
                  serviceId: item.providerService.serviceId,
                },
              },
              data: { stock: { decrement: item.quantity } },
            });
          }
        }

        return newOrder;
      });
      orders.push({ order, provider, requiresPrescription: true });
      paymentReferences.push(paymentReference);
    }

    if (uncoveredItems.length > 0) {
      const totalPrice = await recalculateOrderTotal(uncoveredItems);
      const orderStatus = 'pending_prescription';
      const paymentReference = `order_${Date.now()}_${providerId}_new`;
      const order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            patientIdentifier,
            providerId: parseInt(providerId),
            status: orderStatus,
            deliveryMethod,
            address: deliveryMethod === 'delivery' ? address : null,
            email,
            phone: normalizedPhone,
            totalPrice,
            paymentReference,
            paymentStatus: 'pending',
            checkoutSessionId,
            createdAt: new Date(),
            updatedAt: new Date(),
            prescriptionId: newPrescription.id,
            timeSlotStart: timeSlotStart ? new Date(timeSlotStart) : null,
            timeSlotEnd: timeSlotEnd ? new Date(timeSlotEnd) : null,
          },
        });

        for (const item of uncoveredItems) {
          await tx.orderItem.create({
            data: {
              orderId: newOrder.id,
              providerId: item.providerService.providerId,
              serviceId: item.providerService.serviceId,
              quantity: item.quantity,
              price: item.price,
            },
          });

          if (item.providerService.service.type === 'medication') {
            await tx.providerService.update({
              where: {
                providerId_serviceId: {
                  providerId: item.providerService.providerId,
                  serviceId: item.providerService.serviceId,
                },
              },
              data: { stock: { decrement: item.quantity } },
            });
          }
        }

        return newOrder;
      });
      orders.push({ order, provider, requiresPrescription: true });
      paymentReferences.push(paymentReference);
    }

    if (nonPrescriptionItems.length > 0) {
      const totalPrice = await recalculateOrderTotal(nonPrescriptionItems);
      const orderStatus = 'pending';
      const paymentReference = `order_${Date.now()}_${providerId}_non_prescription`;
      const order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            patientIdentifier,
            providerId: parseInt(providerId),
            status: orderStatus,
            deliveryMethod,
            address: deliveryMethod === 'delivery' ? address : null,
            email,
            phone: normalizedPhone,
            totalPrice,
            paymentReference,
            paymentStatus: 'pending',
            checkoutSessionId,
            createdAt: new Date(),
            updatedAt: new Date(),
            prescriptionId: null,
            timeSlotStart: timeSlotStart ? new Date(timeSlotStart) : null,
            timeSlotEnd: timeSlotEnd ? new Date(timeSlotEnd) : null,
          },
        });

        for (const item of nonPrescriptionItems) {
          await tx.orderItem.create({
            data: {
              orderId: newOrder.id,
              providerId: item.providerService.providerId,
              serviceId: item.providerService.serviceId,
              quantity: item.quantity,
              price: item.price,
            },
          });

          if (item.providerService.service.type === 'medication') {
            await tx.providerService.update({
              where: {
                providerId_serviceId: {
                  providerId: item.providerService.providerId,
                  serviceId: item.providerService.serviceId,
                },
              },
              data: { stock: { decrement: item.quantity } },
            });
          }
        }

        return newOrder;
      });
      orders.push({ order, provider, requiresPrescription: false });
      paymentReferences.push(paymentReference);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { orderId: cartOrder.id } });
    await tx.order.delete({ where: { id: cartOrder.id } });
  });

  const payableOrders = orders.filter(o => o.order.status === 'pending');
  console.log('Payable orders:', payableOrders.map(o => ({ orderId: o.order.id, provider: o.provider.name, totalPrice: o.order.totalPrice })));

  if (payableOrders.length > 0) {
    const totalPayableAmount = payableOrders.reduce((sum, o) => sum + o.order.totalPrice, 0) * 100;
    const transactionReference = `session_${checkoutSessionId}_${Date.now()}`;

    console.log('Initiating Paystack for payable orders:', { totalPayableAmount, transactionReference });

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
        createdAt: new Date(),
      },
    });

    return {
      message: 'Checkout initiated for payable items',
      checkoutSessionId,
      transactionReference,
      paymentReferences,
      paymentUrl: paystackResponse.data.data.authorization_url,
      orders: orders.map(o => ({
        orderId: o.order.id,
        provider: o.provider.name,
        status: o.order.status,
        totalPrice: o.order.totalPrice,
        paymentReference: o.order.paymentReference,
        prescriptionId: o.order.prescriptionId,
      })),
    };
  }

  console.log('Returning prescription-only response:', { checkoutSessionId });
  return {
    message: 'Prescription submitted, awaiting verification',
    checkoutSessionId,
    orders: orders.map(o => ({
      orderId: o.order.id,
      provider: o.provider.name,
      status: o.order.status,
      totalPrice: o.order.totalPrice,
      prescriptionId: o.order.prescriptionId,
    })),
  };
}

async function retrieveSession({ email, phone, checkoutSessionId }) {
  let guestId = null;

  if (checkoutSessionId) {
    console.log('Checking order by checkoutSessionId:', checkoutSessionId);
    const order = await prisma.order.findFirst({
      where: { checkoutSessionId },
      select: { patientIdentifier: true },
    });
    if (order) {
      guestId = order.patientIdentifier;
      console.log('Found guestId by checkoutSessionId:', guestId);
    }
  } else if (email || phone) {
    const orConditions = [];
    if (email) orConditions.push({ email });
    if (phone) orConditions.push({ phone: normalizePhone(phone) });

    console.log('OR conditions:', JSON.stringify(orConditions));

    const orderQuery = {
      where: { ...(orConditions.length > 0 && { OR: orConditions }) },
      select: { patientIdentifier: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    };
    const prescriptionQuery = {
      where: { ...(orConditions.length > 0 && { OR: orConditions }) },
      select: { patientIdentifier: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    };

    console.log('Order query:', JSON.stringify(orderQuery));
    console.log('Prescription query:', JSON.stringify(prescriptionQuery));

    const [order, prescription] = await prisma.$transaction([
      prisma.order.findFirst(orderQuery),
      prisma.prescription.findFirst(prescriptionQuery),
    ]);

    console.log('Order result:', order);
    console.log('Prescription result:', prescription);

    if (order && prescription) {
      guestId = order.createdAt > prescription.createdAt ? order.patientIdentifier : prescription.patientIdentifier;
      console.log('Selected guestId (order vs prescription):', guestId);
    } else {
      guestId = order?.patientIdentifier || prescription?.patientIdentifier;
      console.log('Selected guestId (single result):', guestId);
    }
  }

  if (!guestId) {
    throw new Error('Session not found');
  }

  return guestId;
}

async function validatePrescription({ patientIdentifier, serviceIds }) {
  if (!patientIdentifier) {
    throw new Error('patientIdentifier required');
  }
  if (!serviceIds) {
    return false; // No service IDs means no prescription required
  }
  const ids = serviceIds.split(',').map(Number).filter(id => !isNaN(id));
  if (ids.length === 0) {
    return false; // Invalid or empty IDs means no prescription required
  }
  const prescriptions = await prisma.prescription.findMany({
    where: { patientIdentifier, status: 'verified' },
    include: { prescriptionServices: true },
  });
  if (!prescriptions.length) {
    return true; // No verified prescriptions means upload is required
  }
  const prescriptionServiceIds = prescriptions
    .flatMap(prescription => prescription.prescriptionServices.map(ps => ps.serviceId));
  console.log('Prescription service IDs:', prescriptionServiceIds);
  return !ids.every(id => prescriptionServiceIds.includes(id)); // Upload required if any ID is not covered
}

async function getSessionDetails({ orderId, userId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      checkoutSessionId: true,
      patientIdentifier: true,
      email: true,
      prescriptionId: true,
    },
  });

  if (!order || order.patientIdentifier !== userId || !order.prescriptionId) {
    throw new Error('Order not found, unauthorized, or not linked to a prescription');
  }

  const prescription = await prisma.prescription.findUnique({
    where: { id: order.prescriptionId },
    select: { patientIdentifier: true },
  });

  if (!prescription || prescription.patientIdentifier !== userId) {
    throw new Error('Prescription not found or not linked to the same patient');
  }

  const sessionOrders = await prisma.order.findMany({
    where: {
      checkoutSessionId: order.checkoutSessionId,
      patientIdentifier: userId,
      prescriptionId: { not: null },
      prescription: { patientIdentifier: userId },
    },
    select: {
      id: true,
      totalPrice: true,
      status: true,
      prescriptionId: true,
    },
  });

  if (sessionOrders.length === 0) {
    throw new Error('No orders found in this session with a valid prescription');
  }

  const totalAmount = sessionOrders
    .filter(o => o.status === 'pending')
    .reduce((sum, o) => sum + o.totalPrice, 0);

  console.log('Session details retrieved:', { orderId, userId, checkoutSessionId: order.checkoutSessionId, totalAmount });

  return {
    message: 'Session details retrieved',
    checkoutSessionId: order.checkoutSessionId,
    totalAmount,
    email: order.email || null,
    orders: sessionOrders.map(o => ({
      orderId: o.id,
      totalPrice: o.totalPrice,
      status: o.status,
      prescriptionId: o.prescriptionId,
    })),
  };
}

async function resumeCheckout({ orderId, email, userId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          providerService: {
            include: { service: true },
          },
        },
      },
      prescription: true,
    },
  });

  if (!order || order.patientIdentifier !== userId) {
    throw new Error('Order not found or unauthorized');
  }

  const sessionOrders = await prisma.order.findMany({
    where: {
      checkoutSessionId: order.checkoutSessionId,
      patientIdentifier: userId,
      status: 'pending',
    },
    include: {
      items: {
        include: {
          providerService: {
            include: { service: true },
          },
        },
      },
      prescription: true,
    },
  });

  if (sessionOrders.length === 0) {
    throw new Error('No orders awaiting payment in this session');
  }

  for (const sessionOrder of sessionOrders) {
    const requiresPrescription = sessionOrder.items.some(
      item => item.providerService.service.prescriptionRequired
    );
    if (requiresPrescription && (!sessionOrder.prescription || sessionOrder.prescription.status !== 'verified')) {
      throw new Error(`Prescription not verified for order ${sessionOrder.id}`);
    }
  }

  const totalAmount = sessionOrders.reduce((sum, o) => sum + o.totalPrice, 0) * 100;
  if (totalAmount <= 0) {
    throw new Error('Invalid order amount');
  }

  const transactionReference = `session_${order.checkoutSessionId}_${Date.now()}`;
  const paymentReferences = [];

  const paystackResponse = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email,
      amount: totalAmount,
      reference: transactionReference,
      callback_url: `${process.env.PAYSTACK_CALLBACK_URL}?session=${order.checkoutSessionId}`,
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
    for (const sessionOrder of sessionOrders) {
      const orderSpecificReference = `order_${sessionOrder.id}_${order.checkoutSessionId}_${Date.now()}`;
      await tx.order.update({
        where: { id: sessionOrder.id },
        data: {
          paymentReference: orderSpecificReference,
          paymentStatus: 'pending',
          updatedAt: new Date(),
        },
      });
      paymentReferences.push(orderSpecificReference);
    }
    await tx.transactionReference.create({
      data: {
        transactionReference,
        orderReferences: paymentReferences,
        checkoutSessionId: order.checkoutSessionId,
        createdAt: new Date(),
      },
    });
  });

  console.log('Checkout resumed for session:', { orderId, userId, checkoutSessionId: order.checkoutSessionId, totalAmount, transactionReference, paymentReferences });

  return {
    message: 'Checkout resumed for session',
    checkoutSessionId: order.checkoutSessionId,
    transactionReference,
    paymentReferences,
    paymentUrl: paystackResponse.data.data.authorization_url,
    totalAmount: totalAmount / 100,
    orders: sessionOrders.map(o => ({
      orderId: o.id,
      totalPrice: o.totalPrice,
      status: o.status,
      paymentReference: o.paymentReference,
    })),
  };
}

async function getResumeOrders({ orderId, userId }) {
  const initialOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { checkoutSessionId: true, patientIdentifier: true, prescriptionId: true, status: true },
  });

  if (!initialOrder || initialOrder.patientIdentifier !== userId || !initialOrder.prescriptionId || initialOrder.status !== 'pending') {
    throw new Error('Order not found, unauthorized, not linked to a prescription, or not pending');
  }

  const orders = await prisma.order.findMany({
    where: {
      checkoutSessionId: initialOrder.checkoutSessionId,
      patientIdentifier: userId,
      prescriptionId: initialOrder.prescriptionId,
      status: 'pending',
    },
    include: {
      items: {
        include: {
          providerService: { include: { service: true, provider: true } },
        },
      },
      prescription: true,
      provider: true,
    },
  });

  if (!orders.length) {
    throw new Error('No pending orders found for this session');
  }

  const providers = orders.reduce((acc, order) => {
    const providerId = order.providerId;
    const existing = acc.find(p => p.provider.id === providerId);
    const orderData = {
      id: order.id,
      totalPrice: order.totalPrice,
      status: order.status,
      email: order.email || null,
      prescription: order.prescription
        ? { id: order.prescription.id, status: order.prescription.status, uploadedAt: order.prescription.createdAt }
        : null,
      items: order.items.map(item => ({
        id: item.id,
        quantity: item.quantity,
        price: item.price,
        service: { id: item.providerService.service.id, name: item.providerService.service.name },
      })),
    };

    if (existing) {
      existing.orders.push(orderData);
    } else {
      acc.push({
        provider: { id: order.provider.id, name: order.provider.name, address: order.provider.address },
        orders: [orderData],
      });
    }
    return acc;
  }, []);

  return {
    providers,
    trackingCode: orders[0].trackingCode || 'Pending',
  };
}

module.exports = {
  initiateCheckout,
  retrieveSession,
  validatePrescription,
  getSessionDetails,
  resumeCheckout,
  getResumeOrders,
};