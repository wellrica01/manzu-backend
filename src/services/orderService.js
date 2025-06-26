const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { recalculateOrderTotal } = require('../utils/orderUtils');
const { parse, startOfDay, endOfDay } = require('date-fns');
const prisma = new PrismaClient();

async function addToOrder({ serviceId, providerId, quantity, userId }) {
  userId = userId || uuidv4();

  if (!providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid provider ID');
  }
  if (!serviceId || isNaN(parseInt(serviceId))) {
    throw new Error('Invalid service ID');
  }

  const provider = await prisma.provider.findUnique({ where: { id: parseInt(providerId) } });
  if (!provider) {
    throw new Error('Provider not found');
  }

  let order = await prisma.order.findFirst({
    where: {
      patientIdentifier: userId,
      status: { in: ['pending_prescription', 'pending', 'cart'] },
    },
  });

  if (order && order.status !== 'cart') {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'cart', providerId: parseInt(providerId) },
    });
  } else if (!order) {
    order = await prisma.order.create({
      data: {
        patientIdentifier: userId,
        status: 'cart',
        totalPrice: 0,
        providerId: parseInt(providerId),
        deliveryMethod: 'unspecified',
        paymentStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  const providerService = await prisma.providerService.findFirst({
    where: {
      serviceId: parseInt(serviceId),
      providerId: parseInt(providerId),
      OR: [
        { stock: { gte: quantity } },
        { available: true },
      ],
    },
  });

  if (!providerService) {
    throw new Error('Service not available at this provider or insufficient stock');
  }

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
        quantity: { increment: quantity || 1 },
        price: providerService.price,
      },
      create: {
        orderId: order.id,
        providerId: parseInt(providerId),
        serviceId: parseInt(serviceId),
        quantity: quantity || 1,
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
    items: order.items,
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
        { stock: { gte: quantity || 1 } },
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
      data: { quantity: quantity || 1, price: providerService.price },
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

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.delete({
      where: { id: orderItemId, orderId: order.id },
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
            timeSlotStart: { lte: slotEnd },
            timeSlotEnd: { gte: slotStart },
            status: { not: 'cancelled' },
            ...(serviceId && { items: { some: { serviceId: parseInt(serviceId) } } }),
            ...(fulfillmentType && { deliveryMethod: fulfillmentType }),
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
        fulfillmentType: fulfillmentType || 'in_person',
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

  // 🔍 Resolve orderId from itemId
  const item = await prisma.orderItem.findUnique({
    where: { id: parseInt(itemId) },
    select: { orderId: true },
  });

  if (!item) {
    throw new Error('Order item not found');
  }

  const orderId = item.orderId;

  const order = await prisma.order.findFirst({
    where: { id: orderId, patientIdentifier: userId },
    include: { items: true },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  // ⏰ Slot + fulfillment logic
  const updates = {};
  if (timeSlotStart) {
    const start = new Date(timeSlotStart);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    updates.timeSlotStart = start;
    updates.timeSlotEnd = end;
  }

  if (fulfillmentType) {
    if (!['lab_visit', 'delivery'].includes(fulfillmentType)) {
      throw new Error('Invalid fulfillment type');
    }

    if (fulfillmentType === 'delivery') {
      const providerId = order.items[0]?.providerId;
      const provider = await prisma.provider.findFirst({
        where: { id: providerId },
        select: { homeCollectionAvailable: true },
      });

      if (!provider?.homeCollectionAvailable) {
        throw new Error('Delivery not available for this provider');
      }
    }

    updates.deliveryMethod = fulfillmentType;
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: updates,
  });

  return { message: 'Order details updated', order: updatedOrder };
}


module.exports = {
  addToOrder,
  getOrder,
  updateOrderItem,
  removeFromOrder,
  getTimeSlots,
  updateOrderDetails,
};