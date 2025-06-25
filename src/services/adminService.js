const { PrismaClient } = require('@prisma/client');
const NodeGeocoder = require('node-geocoder');
const prisma = new PrismaClient();

const geocoder = NodeGeocoder({
  provider: 'opencage',
  apiKey: process.env.OPENCAGE_API_KEY,
});

async function getDashboardOverview() {
  const [providerCount, serviceCount, prescriptionCount, orderCount, userCount, pendingPrescriptions, verifiedProviders, recentOrders] = await prisma.$transaction([
    prisma.provider.count(),
    prisma.service.count(),
    prisma.prescription.count(),
    prisma.order.count(),
    prisma.providerUser.count(),
    prisma.prescription.count({ where: { status: 'pending' } }),
    prisma.provider.count({ where: { status: 'verified' } }),
    prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, trackingCode: true, patientIdentifier: true, totalPrice: true, status: true, createdAt: true },
    }),
  ]);

  const summary = {
    providers: { total: providerCount, verified: verifiedProviders },
    services: { total: serviceCount },
    prescriptions: { total: prescriptionCount, pending: pendingPrescriptions },
    orders: { total: orderCount, recent: recentOrders },
    users: { total: userCount },
  };

  console.log('Dashboard data fetched:', summary);
  return summary;
}

async function getProviders({ page = 1, limit = 10 }) {
  const skip = (page - 1) * limit;

  const [providers, total] = await prisma.$transaction([
    prisma.provider.findMany({
      select: {
        id: true,
        name: true,
        address: true,
        lga: true,
        state: true,
        phone: true,
        licenseNumber: true,
        status: true,
        logoUrl: true,
        isActive: true,
        homeCollectionAvailable: true,
        createdAt: true,
        verifiedAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.provider.count(),
  ]);

  return {
    providers,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

async function getSimpleProviders() {
  const simpleProviders = await prisma.provider.findMany({
    select: {
      id: true,
      name: true,
    },
  });
  console.log('Providers fetched for filter:', { count: simpleProviders.length });
  return simpleProviders;
}

async function getProvider(id) {
  const provider = await prisma.provider.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      lga: true,
      state: true,
      phone: true,
      licenseNumber: true,
      status: true,
      logoUrl: true,
      isActive: true,
      homeCollectionAvailable: true,
      createdAt: true,
      verifiedAt: true,
    },
  });
  if (!provider) {
    const error = new Error('Provider not found');
    error.status = 404;
    throw error;
  }
  console.log('Provider fetched:', { providerId: id });
  return provider;
}

async function updateProvider(id, data) {
  const existingProvider = await prisma.provider.findUnique({
    where: { id },
  });
  if (!existingProvider) {
    const error = new Error('Provider not found');
    error.status = 404;
    throw error;
  }
  if (data.licenseNumber && data.licenseNumber !== existingProvider.licenseNumber) {
    const licenseConflict = await prisma.provider.findUnique({
      where: { licenseNumber: data.licenseNumber },
    });
    if (licenseConflict) {
      const error = new Error('License number already exists');
      error.status = 400;
      throw error;
    }
  }
  const addressString = `${data.address}, ${data.lga}, ${data.state}, Nigeria`;
  const geoResult = await geocoder.geocode(addressString);
  if (!geoResult.length) {
    const error = new Error('Invalid address: unable to geocode');
    error.status = 400;
    throw error;
  }
  const { latitude, longitude } = geoResult[0];
  const updatedProvider = await prisma.$transaction(async (prisma) => {
    const provider = await prisma.provider.update({
      where: { id },
      data: {
        name: data.name,
        address: data.address,
        lga: data.lga,
        state: data.state,
        phone: data.phone,
        licenseNumber: data.licenseNumber,
        status: data.status,
        logoUrl: data.logoUrl,
        isActive: data.isActive,
        homeCollectionAvailable: data.homeCollectionAvailable,
        verifiedAt: data.status === 'verified' ? new Date() : data.status === 'rejected' ? null : existingProvider.verifiedAt,
      },
    });
    await prisma.$queryRaw`
      UPDATE "Provider"
      SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      WHERE id = ${id}
    `;
    return provider;
  });
  console.log('Provider updated:', { providerId: id });
  return {
    id: updatedProvider.id,
    name: updatedProvider.name,
    address: updatedProvider.address,
    lga: updatedProvider.lga,
    state: updatedProvider.state,
    phone: updatedProvider.phone,
    licenseNumber: updatedProvider.licenseNumber,
    status: updatedProvider.status,
    logoUrl: updatedProvider.logoUrl,
    isActive: updatedProvider.isActive,
    homeCollectionAvailable: updatedProvider.homeCollectionAvailable,
    createdAt: updatedProvider.createdAt,
    verifiedAt: updatedProvider.verifiedAt,
  };
}

async function deleteProvider(id) {
  const existingProvider = await prisma.provider.findUnique({
    where: { id },
  });
  if (!existingProvider) {
    const error = new Error('Provider not found');
    error.status = 404;
    throw error;
  }
  await prisma.provider.delete({
    where: { id },
  });
  console.log('Provider deleted:', { providerId: id });
}

async function getServices({ page, limit, name, genericName, category, type, prescriptionRequired, providerId }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (genericName) where.genericName = { contains: genericName, mode: 'insensitive' };
  if (category) where.category = { equals: category };
  if (type) where.type = type;
  if (prescriptionRequired !== undefined) where.prescriptionRequired = prescriptionRequired;
  if (providerId) where.providerServices = { some: { providerId } };
  const [services, total] = await prisma.$transaction([
    prisma.service.findMany({
      where,
      select: {
        id: true,
        name: true,
        genericName: true,
        type: true,
        category: true,
        description: true,
        manufacturer: true,
        form: true,
        dosage: true,
        nafdacCode: true,
        testType: true,
        testCode: true,
        prepInstructions: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        providerServices: {
          select: {
            stock: true,
            price: true,
            available: true,
            provider: { select: { id: true, name: true } },
          },
        },
      },
      take: limit,
      skip,
    }),
    prisma.service.count({ where }),
  ]);
  console.log('Services fetched:', { count: services.length, total });
  return {
    services,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getService(id) {
  const service = await prisma.service.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      genericName: true,
      type: true,
      category: true,
      description: true,
      manufacturer: true,
      form: true,
      dosage: true,
      nafdacCode: true,
      testType: true,
      testCode: true,
      prepInstructions: true,
      prescriptionRequired: true,
      imageUrl: true,
      createdAt: true,
      providerServices: {
        select: {
          stock: true,
          price: true,
          available: true,
          provider: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!service) {
    const error = new Error('Service not found');
    error.status = 404;
    throw error;
  }
  console.log('Service fetched:', { serviceId: id });
  return service;
}

async function createService(data) {
  const service = await prisma.service.create({
    data: {
      ...data,
      createdAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      genericName: true,
      type: true,
      category: true,
      description: true,
      manufacturer: true,
      form: true,
      dosage: true,
      nafdacCode: true,
      testType: true,
      testCode: true,
      prepInstructions: true,
      prescriptionRequired: true,
      imageUrl: true,
      createdAt: true,
    },
  });
  console.log('Service created:', { serviceId: service.id });
  return service;
}

async function updateService(id, data) {
  try {
    const service = await prisma.service.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        genericName: true,
        type: true,
        category: true,
        description: true,
        manufacturer: true,
        form: true,
        dosage: true,
        nafdacCode: true,
        testType: true,
        testCode: true,
        prepInstructions: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        providerServices: {
          select: {
            stock: true,
            price: true,
            available: true,
            provider: { select: { id: true, name: true } },
          },
        },
      },
    });
    console.log('Service updated:', { serviceId: id });
    return service;
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Service not found');
      err.status = 404;
      throw err;
    }
    throw error;
  }
}

async function deleteService(id) {
  try {
    await prisma.$transaction(async (prisma) => {
      await prisma.orderItem.deleteMany({
        where: { serviceId: id },
      });
      await prisma.providerService.deleteMany({
        where: { serviceId: id },
      });
      await prisma.service.delete({
        where: { id },
      });
    });
    console.log('Service, related ProviderService, and OrderItem records deleted:', { serviceId: id });
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Service not found');
      err.status = 404;
      throw err;
    }
    throw error;
  }
}

async function getPrescriptions({ page, limit, status, patientIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status;
  if (patientIdentifier) where.patientIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
  const [prescriptions, total] = await prisma.$transaction([
    prisma.prescription.findMany({
      where,
      select: {
        id: true,
        patientIdentifier: true,
        fileUrl: true,
        status: true,
        verified: true,
        createdAt: true,
        orders: {
          select: {
            id: true,
            trackingCode: true,
            status: true,
            provider: { select: { id: true, name: true } },
          },
        },
      },
      take: limit,
      skip,
    }),
    prisma.prescription.count({ where }),
  ]);
  console.log('Prescriptions fetched:', { count: prescriptions.length, total });
  return {
    prescriptions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getPrescription(id) {
  const prescription = await prisma.prescription.findUnique({
    where: { id },
    include: {
      orders: {
        include: {
          provider: true,
          items: {
            include: {
              providerService: {
                include: { service: true },
              },
            },
          },
        },
      },
    },
  });
  if (!prescription) {
    const error = new Error('Prescription not found');
    error.status = 404;
    throw error;
  }
  console.log('Prescription fetched:', { prescriptionId: id });
  return prescription;
}

async function getOrders({ page, limit, status, patientIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status;
  if (patientIdentifier) where.patientIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        patientIdentifier: true,
        status: true,
        totalPrice: true,
        createdAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.order.count({ where }),
  ]);
  console.log('Orders fetched:', { count: orders.length, total });
  return {
    orders,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getOrder(id) {
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      patientIdentifier: true,
      status: true,
      totalPrice: true,
      deliveryMethod: true,
      address: true,
      email: true,
      phone: true,
      trackingCode: true,
      filledAt: true,
      cancelledAt: true,
      cancelReason: true,
      paymentReference: true,
      paymentStatus: true,
      timeSlotStart: true,
      timeSlotEnd: true,
      createdAt: true,
      updatedAt: true,
      provider: {
        select: { id: true, name: true },
      },
      prescription: {
        select: {
          id: true,
          patientIdentifier: true,
          status: true,
          fileUrl: true,
          verified: true,
        },
      },
      items: {
        select: {
          providerService: {
            select: {
              service: {
                select: { id: true, name: true, genericName: true, type: true },
              },
              provider: {
                select: { id: true, name: true },
              },
            },
          },
          quantity: true,
          price: true,
        },
      },
    },
  });
  if (!order) {
    const error = new Error('Order not found');
    error.status = 404;
    throw error;
  }
  console.log('Order fetched:', { orderId: id });
  return order;
}

async function getAdminUsers({ page, limit, role, email }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (role) where.role = role;
  if (email) where.email = { contains: email, mode: 'insensitive' };
  const [users, total] = await prisma.$transaction([
    prisma.adminUser.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.adminUser.count({ where }),
  ]);
  console.log('Admin users fetched:', { count: users.length, total });
  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getAdminUser(id) {
  const user = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });
  if (!user) {
    const error = new Error('Admin user not found');
    error.status = 404;
    throw error;
  }
  console.log('Admin user fetched:', { userId: id });
  return user;
}

async function getProviderUsers({ page, limit, role, email, providerId }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (role) where.role = role;
  if (email) where.email = { contains: email, mode: 'insensitive' };
  if (providerId) where.providerId = providerId;
  const [users, total] = await prisma.$transaction([
    prisma.providerUser.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        provider: {
          select: { id: true, name: true },
        },
      },
      take: limit,
      skip,
    }),
    prisma.providerUser.count({ where }),
  ]);
  console.log('Provider users fetched:', { count: users.length, total });
  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getProviderUser(id) {
  const user = await prisma.providerUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastLogin: true,
      provider: {
        select: { id: true, name: true },
      },
    },
  });
  if (!user) {
    const error = new Error('Provider user not found');
    error.status = 404;
    throw error;
  }
  console.log('Provider user fetched:', { userId: id });
  return user;
}

module.exports = {
  getDashboardOverview,
  getProviders,
  getSimpleProviders,
  getProvider,
  updateProvider,
  deleteProvider,
  getServices,
  getService,
  createService,
  updateService,
  deleteService,
  getPrescriptions,
  getPrescription,
  getOrders,
  getOrder,
  getAdminUsers,
  getAdminUser,
  getProviderUsers,
  getProviderUser,
};