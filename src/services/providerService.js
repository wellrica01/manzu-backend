const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fetchOrders(providerId) {
  if (!providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid provider ID');
  }

  const orders = await prisma.order.findMany({
    where: {
      items: {
        some: {
          providerService: {
            providerId,
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
      fulfillmentMethod: true,
      fulfillmentType: true,
      address: true,
      status: true,
      totalPrice: true,
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          providerService: {
            select: {
              service: { select: { name: true, type: true } },
              provider: { select: { name: true, address: true } },
              providerId: true,
            },
          },
        },
      },
    },
  });

  return orders.map(order => ({
    id: order.id,
    createdAt: order.createdAt,
    trackingCode: order.trackingCode,
    patientIdentifier: order.patientIdentifier,
    fulfillmentMethod: order.fulfillmentMethod,
    fulfillmentType: order.fulfillmentType,
    address: order.address,
    status: order.status,
    totalPrice: order.totalPrice,
    items: order.items
      .filter(item => item.providerService.providerId === parseInt(providerId))
      .map(item => ({
        id: item.id,
        service: { 
          name: item.providerService.service.name,
          type: item.providerService.service.type,
        },
        provider: {
          name: item.providerService.provider.name,
          address: item.providerService.provider.address,
        },
        quantity: item.quantity,
        price: item.price,
      })),
  }));
}

async function updateOrderStatus(orderId, status, providerId) {
  if (!orderId || isNaN(parseInt(orderId)) || !providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid order or provider ID');
  }

  const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled', 'sample_collected', 'result_ready', 'completed'];
  if (!validStatuses.includes(status)) {
    throw new Error('Invalid status value');
  }

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      items: {
        some: {
          providerService: {
            providerId,
          },
        },
      },
    },
  });
  
  if (!order) {
    throw new Error('Order not found for provider');
  }

  const updateData = { status, updatedAt: new Date() };
  if (status === 'delivered' || status === 'ready_for_pickup' || status === 'completed') {
    updateData.filledAt = new Date();
  }

  const updatedOrder = await prisma.order.update({
    where: { id: parseInt(orderId) },
    data: updateData,
  });

  console.log('Order status updated:', { orderId, status: updatedOrder.status, filledAt: updatedOrder.filledAt });
  return updatedOrder;
}

async function fetchServices(providerId) {
  if (!providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid provider ID');
  }

  const services = await prisma.providerService.findMany({
    where: { providerId: parseInt(providerId) },
    include: { service: true },
  });
  const allServices = await prisma.service.findMany();

  return {
    services: services.map(s => ({
      providerId: s.providerId,
      serviceId: s.serviceId,
      name: s.service.name,
      type: s.service.type,
      stock: s.stock,
      price: s.price,
      available: s.available,
      receivedDate: s.receivedDate,
      expiryDate: s.expiryDate,
    })),
    availableServices: allServices.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
    })),
  };
}

async function addService({ providerId, serviceId, stock, price, available, receivedDate, expiryDate }) {
  if (!providerId || isNaN(parseInt(providerId)) || !serviceId || isNaN(parseInt(serviceId))) {
    throw new Error('Invalid provider or service ID');
  }
  if (isNaN(parseFloat(price)) || price < 0) {
    throw new Error('Invalid price');
  }

  const existing = await prisma.providerService.findUnique({
    where: { providerId_serviceId: { providerId: parseInt(providerId), serviceId: parseInt(serviceId) } },
  });
  if (existing) {
    throw new Error('Service already exists in provider inventory');
  }

  const service = await prisma.providerService.create({
    data: {
      providerId: parseInt(providerId),
      serviceId: parseInt(serviceId),
      stock: stock ? parseInt(stock) : null,
      price: parseFloat(price),
      available: Boolean(available),
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    },
    include: { service: true },
  });

  console.log('Service added:', { providerId: service.providerId, serviceId: service.serviceId });
  return {
    providerId: service.providerId,
    serviceId: service.serviceId,
    name: service.service.name,
    type: service.service.type,
    stock: service.stock,
    price: service.price,
    available: service.available,
    receivedDate: service.receivedDate,
    expiryDate: service.expiryDate,
  };
}

async function updateService({ providerId, serviceId, stock, price, available, receivedDate, expiryDate }) {
  if (!providerId || isNaN(parseInt(providerId)) || !serviceId || isNaN(parseInt(serviceId))) {
    throw new Error('Invalid provider or service ID');
  }
  if (isNaN(parseFloat(price)) || price < 0) {
    throw new Error('Invalid price');
  }

  const service = await prisma.providerService.findUnique({
    where: { providerId_serviceId: { providerId: parseInt(providerId), serviceId: parseInt(serviceId) } },
    include: { service: true },
  });
  if (!service) {
    throw new Error('Service not found');
  }

  const updatedService = await prisma.providerService.update({
    where: { providerId_serviceId: { providerId: parseInt(providerId), serviceId: parseInt(serviceId) } },
    data: {
      stock: stock !== undefined ? parseInt(stock) : service.stock,
      price: parseFloat(price),
      available: available !== undefined ? Boolean(available) : service.available,
      receivedDate: receivedDate ? new Date(receivedDate) : service.receivedDate,
      expiryDate: expiryDate ? new Date(expiryDate) : service.expiryDate,
    },
    include: { service: true },
  });

  console.log('Service updated:', { providerId: updatedService.providerId, serviceId: updatedService.serviceId });
  return {
    providerId: updatedService.providerId,
    serviceId: updatedService.serviceId,
    name: updatedService.service.name,
    type: updatedService.service.type,
    stock: updatedService.stock,
    price: updatedService.price,
    available: updatedService.available,
    receivedDate: updatedService.receivedDate,
    expiryDate: updatedService.expiryDate,
  };
}

async function deleteService(providerId, serviceId) {
  if (!providerId || isNaN(parseInt(providerId)) || !serviceId || isNaN(parseInt(serviceId))) {
    throw new Error('Invalid provider or service ID');
  }

  const service = await prisma.providerService.findUnique({
    where: { providerId_serviceId: { providerId: parseInt(providerId), serviceId: parseInt(serviceId) } },
  });
  if (!service) {
    throw new Error('Service not found');
  }

  await prisma.providerService.delete({
    where: { providerId_serviceId: { providerId: parseInt(providerId), serviceId: parseInt(serviceId) } },
  });

  console.log('Service deleted:', { providerId, serviceId });
}

async function fetchUsers(providerId) {
  if (!providerId || isNaN(parseInt(providerId))) {
    throw new Error('Invalid provider ID');
  }

  const users = await prisma.user.findMany({
    where: { providerId: parseInt(providerId) },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log('Users fetched:', { providerId, userCount: users.length });
  return users;
}

async function registerDevice(providerId, deviceToken) {
  if (!providerId || isNaN(parseInt(providerId)) || !deviceToken) {
    throw new Error('Invalid provider ID or device token');
  }

  await prisma.provider.update({
    where: { id: parseInt(providerId) },
    data: { deviceToken },
  });
  console.log('Device registered:', { providerId });
}

module.exports = {
  fetchOrders,
  updateOrderStatus,
  fetchServices,
  addService,
  updateService,
  deleteService,
  fetchUsers,
  registerDevice,
};