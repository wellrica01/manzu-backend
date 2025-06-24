const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { recalculateOrderTotal } = require('../utils/orderUtils');
const { parse } = require('date-fns');
const prisma = new PrismaClient();

async function addToOrder({ serviceId, providerId, quantity, userId }) {
  userId = userId || uuidv4();

  // Check if provider exists
  const provider = await prisma.provider.findUnique({ where: { id: providerId } });
  if (!provider) {
    throw new Error('Provider not found');
  }

  // Check if an order already exists for this user
  let order = await prisma.order.findFirst({
    where: {
      patientIdentifier: userId,
      status: { in: ['pending_prescription', 'pending', 'cart'] },
    },
  });

  // If order exists and isn't in 'cart' status, update it
  if (order && order.status !== 'cart') {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'cart' },
    });
  } else if (!order) {
    // Create a new order
    order = await prisma.order.create({
      data: {
        patientIdentifier: userId,
        status: 'cart',
        totalPrice: 0,
        deliveryMethod: 'unspecified',
        paymentStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // Check if the service is available at the selected provider
  const providerService = await prisma.providerService.findFirst({
    where: {
      serviceId,
      providerId,
      OR: [
        { stock: { gte: quantity } }, // For medications
        { available: true }, // For diagnostics
      ],
    },
  });

  if (!providerService) {
    throw new Error('Service not available at this provider or insufficient stock');
  }

  // Perform order item creation/update and total recalculation in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const orderItem = await tx.orderItem.upsert({
      where: {
        orderId_providerId_serviceId: {
          orderId: order.id,
          providerId,
          serviceId,
        },
      },
      update: {
        quantity: { increment: quantity || 1 }, // Default to 1 for diagnostics
        price: providerService.price,
      },
      create: {
        orderId: order.id,
        providerId,
        serviceId,
        quantity: quantity || 1, // Default to 1 for diagnostics
        price: providerService.price,
      },
    });

    const { updatedOrder } = await recalculateOrderTotal(order.id);

    return { orderItem, order: updatedOrder };
  });

  console.log('Created/Updated OrderItem:', result.orderItem);
  return { orderItem: result.orderItem, userId };
}

async function getOrder(userId) {
  const order = await prisma.order.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
    include: {
      items: {
        include: {
          providerService: {
            include: {
              provider: { select: { id: true, name: true, address: true, homeCollectionAvailable: true } },
              service: { select: { id: true, name: true, type: true, category: true, prescriptionRequired: true, prepInstructions: true, description: true, dosage: true, form: true } },
            },
          },
        },
      },
      prescription: { select: { id: true } },
    },
  });

  if (!order) {
    return { providers: [], totalPrice: 0, prescriptionId: null };
  }

  const providerGroups = order.items.reduce((acc, item) => {
    const providerId = item.providerService?.provider?.id;
    if (!providerId) return acc; // Skip if data is incomplete

    if (!acc[providerId]) {
      acc[providerId] = {
        provider: {
          id: providerId,
          name: item.providerService?.provider?.name ?? 'Unknown Provider',
          address: item.providerService?.provider?.address ?? 'No address',
          homeCollectionAvailable: item.providerService?.provider?.homeCollectionAvailable ?? false,
        },
        items: [],
        subtotal: 0,
      };
    }

    const service = item.providerService?.service;
    acc[providerId].items.push({
      id: item.id,
      service: {
        id: service?.id,
        name: service?.name ?? 'Unknown',
        displayName: service?.type === 'medication'
          ? `${service?.name}${service?.dosage ? ` ${service.dosage}` : ''}${service?.form ? ` (${service.form})` : ''}`
          : service?.name,
        category: service?.category,
        description: service?.description,
        prepInstructions: service?.prepInstructions,
        prescriptionRequired: service?.prescriptionRequired ?? false,
      },
      quantity: item.quantity,
      price: item.price,
      serviceId: item.serviceId,
      providerId: item.providerId,
    });

    acc[providerId].subtotal += item.quantity * item.price;
    return acc;
  }, {});

  const providers = Object.values(providerGroups);
  const totalPrice = providers.reduce((sum, p) => sum + p.subtotal, 0);

  console.log('GET /api/orders response:', { providers, totalPrice });

  return {
    providers,
    totalPrice,
    prescriptionId: order.prescriptionId ?? order.prescription?.id ?? null,
  };
}

async function updateOrderItem({ orderItemId, quantity, userId }) {
  const order = await prisma.order.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!order) {
    throw new Error('Order not found');
  }

  const orderItem = await prisma.orderItem.findFirst({
    where: { id: orderItemId, orderId: order.id },
    include: { providerService: true },
  });
  if (!orderItem) {
    throw new Error('Item not found');
  }

  const providerService = await prisma.providerService.findFirst({
    where: {
      serviceId: orderItem.serviceId,
      providerId: orderItem.providerId,
      OR: [
        { stock: { gte: quantity || 1 } }, // For medications
        { available: true }, // For diagnostics
      ],
    },
  });
  if (!providerService) {
    throw new Error('Service not available or insufficient stock');
  }

  // Perform order item update and total recalculation in a transaction
  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { quantity: quantity || 1, price: providerService.price }, // Default to 1 for diagnostics
    });

    await recalculateOrderTotal(order.id);

    return item;
  });

  return updatedItem;
}

async function removeFromOrder({ orderItemId, userId }) {
  const order = await prisma.order.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!order) {
    throw new Error('Order not found');
  }

  // Perform order item deletion and total recalculation in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.delete({
      where: { id: orderItemId, orderId: order.id },
    });

    await recalculateOrderTotal(order.id);
  });
}

async function getTimeSlots({ providerId }) {
  if (!providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid provider ID');
  }

  const provider = await prisma.provider.findUnique({
    where: { id: parseInt(providerId) },
    select: { operatingHours: true },
  });

  if (!provider) {
    throw new Error('Provider not found');
  }

  // Parse operating hours (e.g., "09:00-17:00")
  const [startHour, endHour] = provider.operatingHours
    ? provider.operatingHours.split('-').map(time => parse(time, 'HH:mm', new Date()))
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
      const existingOrder = await prisma.order.findFirst({
        where: {
          providerId: parseInt(providerId),
          timeSlotStart: { lte: slotEnd },
          timeSlotEnd: { gte: slotStart },
          status: { not: 'cancelled' },
        },
      });

      if (!existingOrder) {
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

async function updateOrderDetails({ orderId, timeSlotStart, fulfillmentType, userId }) {
  if (!orderId || isNaN(parseInt(orderId)) || !userId) {
    throw new Error('Invalid order ID or user ID');
  }

  const order = await prisma.order.findFirst({
    where: { id: parseInt(orderId), patientIdentifier: userId },
  });
  if (!order) {
    throw new Error('Order not found');
  }

  const updates = {};
  if (timeSlotStart) {
    const start = new Date(timeSlotStart);
    const end = new Date(start.getTime() + 30 * 60 * 1000); // 30-minute slot
    updates.timeSlotStart = start;
    updates.timeSlotEnd = end;
  }
  if (fulfillmentType) {
    if (!['lab_visit', 'delivery'].includes(fulfillmentType)) {
      throw new Error('Invalid fulfillment type');
    }
    if (fulfillmentType === 'delivery') {
      const provider = await prisma.provider.findFirst({
        where: { id: order.providerId },
        select: { homeCollectionAvailable: true },
      });
      if (!provider?.homeCollectionAvailable) {
        throw new Error('Delivery not available for this provider');
      }
    }
    updates.deliveryMethod = fulfillmentType;
  }

  await prisma.order.update({
    where: { id: parseInt(orderId) },
    data: updates,
  });

  return { message: 'Order details updated' };
}

module.exports = {
  addToOrder,
  getOrder,
  updateOrderItem,
  removeFromOrder,
  getTimeSlots,
  updateOrderDetails,
};