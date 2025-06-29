const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { recalculateOrderTotal } = require('../utils/orderUtils');
const { parse, startOfDay, endOfDay } = require('date-fns');
const prisma = new PrismaClient();

async function addToOrder({ serviceId, providerId, quantity, userId, type }) {
  userId = userId || uuidv4();

  if (!providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid provider ID');
  }
  if (!serviceId || isNaN(parseInt(serviceId))) {
    throw new Error('Invalid service ID');
  }
  if (!type || !['medication', 'diagnostic', 'diagnostic_package'].includes(type)) {
    throw new Error('Invalid or missing service type');
  }
  if (type === 'diagnostic' || type === 'diagnostic_package') {
    quantity = 1;
  } else if (!quantity || quantity < 1) {
    throw new Error('Invalid quantity');
  }

  console.log(`Adding to order: serviceId=${serviceId}, providerId=${providerId}, quantity=${quantity}, type=${type}, userId=${userId}`);

  const provider = await prisma.provider.findUnique({ where: { id: parseInt(providerId) } });
  if (!provider) {
    throw new Error('Provider not found');
  }

  let order = await prisma.order.findFirst({
    where: {
      patientIdentifier: userId,
      status: 'cart',
    },
  });

  if (!order) {
    order = await prisma.order.create({
      data: {
        patientIdentifier: userId,
        status: 'cart',
        totalPrice: 0,
        paymentStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  console.log(`Order ${order.id} found or created`);

  const providerService = await prisma.providerService.findFirst({
    where: {
      serviceId: parseInt(serviceId),
      providerId: parseInt(providerId),
      OR: [
        { stock: type === 'medication' ? { gte: quantity } : undefined },
        { available: true },
      ].filter(Boolean),
    },
  });

  if (!providerService) {
    throw new Error('Service not available at this provider or insufficient stock');
  }

  console.log(`ProviderService found: price=${providerService.price}`);

  const result = await prisma.$transaction(async (tx) => {
    const orderItem = await tx.orderItem.upsert({
      where: {
        orderId_providerId_serviceId: {
          orderId: order.id,
          providerId: parseInt(providerId),
          serviceId: parseInt(serviceId),
        },
      },
      update: {
        quantity: { increment: quantity },
        price: providerService.price,
      },
      create: {
        orderId: order.id,
        providerId: parseInt(providerId),
        serviceId: parseInt(serviceId),
        quantity: quantity,
        price: providerService.price,
      },
    });

    console.log(`OrderItem ${orderItem.id} upserted: quantity=${orderItem.quantity}, price=${orderItem.price}`);

    const { updatedOrder } = await recalculateOrderTotal(order.id, tx);

    return { orderItem, order: updatedOrder };
  });

  console.log(`Order ${order.id} updated with totalPrice: ${result.order.totalPrice}`);

  return { orderItem: result.orderItem, order: result.order, userId };
}

async function getOrder(userId, orderId = null) {
  const where = {
    patientIdentifier: userId,
    ...(orderId ? { id: orderId } : { status: { in: ['cart', 'pending', 'pending_prescription', 'partially_completed'] } }),
  };

  const orders = await prisma.order.findMany({
    where,
    include: {
      items: {
        include: {
          providerService: {
            include: {
              provider: { select: { id: true, name: true, address: true, homeCollectionAvailable: true } },
              service: { select: { id: true, name: true, type: true, category: true, prescriptionRequired: true, prepInstructions: true, description: true, dosage: true, form: true } },
            },
          },
          prescriptions: {
            include: {
              prescription: { select: { id: true, status: true, rejectReason: true } },
            },
          },
        },
      },
      prescription: { select: { id: true } },
    },
  });

  const formattedOrders = orders.map((order) => {
    const providerGroups = order.items.reduce((acc, item) => {
      const providerId = item.providerService?.provider?.id;
      if (!providerId) return acc;

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
          type: service?.type,
        },
        quantity: item.quantity,
        price: item.price,
        serviceId: item.serviceId,
        providerId: item.providerId,
        timeSlotStart: item.timeSlotStart,
        timeSlotEnd: item.timeSlotEnd,
        fulfillmentMethod: item.fulfillmentMethod,
        prescriptions: item.prescriptions.map(p => ({
          id: p.prescription.id,
          status: p.prescription.status,
          rejectReason: p.prescription.rejectReason,
        })),
      });

      acc[providerId].subtotal += item.quantity * item.price;
      return acc;
    }, {});

    const providers = Object.values(providerGroups);
    const totalPrice = providers.reduce((sum, p) => sum + p.subtotal, 0);

    return {
      providers,
      totalPrice,
      prescriptionId: order.prescriptionId ?? order.prescription?.id ?? null,
      items: order.items,
      orderId: order.id,
      status: order.status,
    };
  });

  console.log('GET /api/orders response:', formattedOrders);

  return formattedOrders;
}

async function updateOrderItem({ orderItemId, quantity, userId }) {
  if (!quantity || quantity < 1) {
    throw new Error('Invalid quantity');
  }

  const order = await prisma.order.findFirst({
    where: { patientIdentifier: userId, status: { in: ['cart', 'pending', 'pending_prescription', 'partially_completed'] } },
  });
  if (!order) {
    throw new Error('Order not found');
  }

  const orderItem = await prisma.orderItem.findFirst({
    where: { id: orderItemId, orderId: order.id },
    include: { providerService: { include: { service: true } } },
  });
  if (!orderItem) {
    throw new Error('Item not found');
  }

  if (orderItem.providerService.service.type === 'diagnostic' || orderItem.providerService.service.type === 'diagnostic_package') {
    if (quantity !== 1) {
      throw new Error('Quantity must be 1 for diagnostic items');
    }
    return orderItem; // No update needed if quantity is already 1
  }

  const providerService = await prisma.providerService.findFirst({
    where: {
      serviceId: orderItem.serviceId,
      providerId: orderItem.providerId,
      OR: [
        { stock: { gte: quantity } },
        { available: true },
      ],
    },
  });
  if (!providerService) {
    throw new Error('Service not available or insufficient stock');
  }

  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { quantity, price: providerService.price },
    });

    await recalculateOrderTotal(order.id, tx); // Pass the transaction context

    return item;
  });

  return updatedItem;
}

async function removeFromOrder({ orderItemId, userId }) {
  const order = await prisma.order.findFirst({
    where: {
      patientIdentifier: userId,
      status: {
        in: ['cart', 'pending', 'pending_prescription', 'partially_completed'],
      },
    },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  const orderItem = await prisma.orderItem.findFirst({
    where: {
      id: orderItemId,
      orderId: order.id,
    },
  });

      console.log('User ID:', userId);
    console.log('Order found:', order);
    console.log('Looking for OrderItem with:', {
      id: orderItemId,
      orderId: order?.id,
    });


  if (!orderItem) {
    throw new Error('Order item not found or does not belong to the order');
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.delete({
      where: { id: orderItemId },
    });

    await recalculateOrderTotal(order.id);
  });
}

async function getTimeSlots({ providerId, serviceId, fulfillmentType, date }) {
  if (!providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid provider ID');
  }

  try {
    const provider = await prisma.provider.findUnique({
      where: { id: parseInt(providerId) },
      select: { operatingHours: true, homeCollectionAvailable: true },
    });
    if (!provider) {
      throw new Error('Provider not found');
    }

    let providerService;
    if (serviceId) {
      providerService = await prisma.providerService.findFirst({
        where: {
          providerId: parseInt(providerId),
          serviceId: parseInt(serviceId),
          available: true,
        },
      });
      console.log('ProviderService check:', { providerId, serviceId, providerService });
      if (!providerService) {
        throw new Error('Service not available at this provider');
      }
    }

    if (fulfillmentType === 'home_collection' && !provider.homeCollectionAvailable) {
      throw new Error('Home collection not available for this provider');
    }

    const [startHour, endHour] = provider.operatingHours
      ? provider.operatingHours.split('-').map(time => parse(time, 'HH:mm', new Date()))
      : [new Date().setHours(9, 0, 0), new Date().setHours(17, 0, 0)];

    const targetDate = date ? new Date(date) : new Date();
    const startOfTargetDay = startOfDay(targetDate);
    const endOfTargetDay = endOfDay(targetDate);

    console.log('Server timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Target date:', targetDate.toISOString(), 'Start of day:', startOfTargetDay.toISOString());
    console.log('Operating hours:', { startHour: startHour.toISOString(), endHour: endHour.toISOString() });

    const timeSlots = [];
    let currentTime = new Date(startOfTargetDay.setHours(startHour.getHours(), startHour.getMinutes(), 0));

    while (currentTime < new Date(startOfTargetDay.setHours(endHour.getHours(), endHour.getMinutes(), 0))) {
      const slotStart = new Date(currentTime);
      const slotEnd = new Date(currentTime.setMinutes(currentTime.getMinutes() + 30));

      let existingOrders = 0;
      try {
        existingOrders = await prisma.order.count({
          where: {
            providerId: parseInt(providerId),
            status: { not: 'cancelled' },
            items: {
              some: {
                ...(serviceId && { serviceId: parseInt(serviceId) }),
                ...(fulfillmentType && { fulfillmentMethod: fulfillmentType }),
                timeSlotStart: { lte: slotEnd },
                timeSlotEnd: { gte: slotStart },
              },
            },
          },
        });
      } catch (err) {
        console.error('Error counting existing orders:', err);
        throw new Error('Failed to check existing orders');
      }

      const availabilityStatus = existingOrders >= 3 ? 'limited' : 'available';
      timeSlots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        fulfillmentType: fulfillmentType || 'lab_visit',
        availabilityStatus,
      });

      currentTime = slotEnd;
    }

    console.log('Generated time slots:', timeSlots);
    console.log('Provider:', provider);
    console.log('ProviderService:', providerService);
    return { timeSlots };
  } catch (err) {
    console.error('getTimeSlots error:', err.message, err.stack);
    throw new Error(err.message || 'Server error');
  }
}

async function updateOrderDetails({ itemId, timeSlotStart, fulfillmentType, userId }) {
  if (!itemId || isNaN(parseInt(itemId)) || !userId) {
    throw new Error('Invalid item ID or user ID');
  }

  const orderItem = await prisma.orderItem.findUnique({
    where: { id: parseInt(itemId) },
    include: { order: true, providerService: { include: { provider: true } } },
  });

  if (!orderItem) {
    throw new Error('Order item not found');
  }

  if (orderItem.order.patientIdentifier !== userId) {
    throw new Error('Unauthorized: Order does not belong to this user');
  }

  const updates = {};
  if (timeSlotStart) {
    const start = new Date(timeSlotStart);
    const end = new Date(start.getTime() + 30 * 60 * 1000); // 30-minute slot
    updates.timeSlotStart = start;
    updates.timeSlotEnd = end;
  }

  if (fulfillmentType) {
    if (!['lab_visit', 'home_collection', 'pick_up', 'home_delivery'].includes(fulfillmentType)) {
      throw new Error('Invalid fulfillment type');
    }

    if (fulfillmentType === 'home_collection') {
      const provider = orderItem.providerService.provider;
      if (!provider?.homeCollectionAvailable) {
        throw new Error('Delivery not available for this provider');
      }
    }

    updates.fulfillmentMethod = fulfillmentType;
  }

  const updatedOrderItem = await prisma.orderItem.update({
    where: { id: parseInt(itemId) },
    data: updates,
  });

  return { message: 'Order item details updated', orderItem: updatedOrderItem };
}

module.exports = {
  addToOrder,
  getOrder,
  updateOrderItem,
  removeFromOrder,
  getTimeSlots,
  updateOrderDetails,
};