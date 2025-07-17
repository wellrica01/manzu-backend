const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { validateLocation } = require('../utils/location');
const { ZodError } = require('zod');

async function fetchOrders(pharmacyId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  // Get total count
  const total = await prisma.order.count({
    where: {
      items: {
        some: {
          pharmacyMedication: {
            pharmacyId,
          },
        },
      },
      status: { 
        notIn: ['cart', 'pending', 'pending_prescription'] 
      },
    },
  });
  // Get paginated orders
  const orders = await prisma.order.findMany({
    where: {
      items: {
        some: {
          pharmacyMedication: {
            pharmacyId,
          },
        },
      },
      status: { 
        notIn: ['cart', 'pending', 'pending_prescription'] 
      },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      trackingCode: true,
      patientIdentifier: true,
      deliveryMethod: true,
      address: true,
      status: true,
      totalPrice: true,
      prescription: {
        select: {
          id: true,
          fileUrl: true,
          status: true,
        },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          pharmacyMedication: {
            select: {
              medication: { select: { name: true } },
              pharmacy: { select: { name: true, address: true } },
              pharmacyId: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  return {
    orders: orders.map(order => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      trackingCode: order.trackingCode,
      patientIdentifier: order.patientIdentifier,
      deliveryMethod: order.deliveryMethod,
      address: order.address,
      status: order.status,
      totalPrice: order.totalPrice,
      prescription: order.prescription
        ? {
            id: order.prescription.id,
            fileUrl: order.prescription.fileUrl,
            status: order.prescription.status,
          }
        : null,
      items: order.items
        .filter(item => item.pharmacyMedication.pharmacyId === pharmacyId)
        .map(item => ({
          id: item.id,
          medication: { name: item.pharmacyMedication.medication.name },
          pharmacy: {
            name: item.pharmacyMedication.pharmacy.name,
            address: item.pharmacyMedication.pharmacy.address,
          },
          quantity: item.quantity,
          price: item.price,
        })),
    })),
    total,
  };
}

async function updateOrderStatus(orderId, status, pharmacyId) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      items: {
        some: {
          pharmacyMedication: {
            pharmacyId,
          },
        },
      },
    },
  });
  if (!order) {
    throw new Error('Order not found for pharmacy');
  }

  const updateData = { status };
  if (status === 'delivered' || status === 'ready_for_pickup') {
    updateData.filledAt = new Date();
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: updateData,
  });

  console.log('Order status updated:', { orderId, status: updatedOrder.status, filledAt: updatedOrder.filledAt });
  return updatedOrder;
}

async function fetchMedications(pharmacyId) {
  const medications = await prisma.pharmacyMedication.findMany({
    where: { pharmacyId },
    include: { medication: true },
  });
  const allMedications = await prisma.medication.findMany();

  return {
    medications: medications.map(m => ({
      pharmacyId: m.pharmacyId,
      medicationId: m.medicationId,
      name: m.medication.name,
      stock: m.stock,
      price: m.price,
      expiryDate: m.expiryDate,
      receivedDate: m.receivedDate,
    })),
    availableMedications: allMedications.map(m => ({
      id: m.id,
      name: m.name,
    })),
  };
}

async function addMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate }) {
  const existing = await prisma.pharmacyMedication.findUnique({
    where: { pharmacyId_medicationId: { pharmacyId, medicationId } },
  });
  if (existing) {
    throw new Error('Medication already exists in pharmacy inventory');
  }

  const medication = await prisma.pharmacyMedication.create({
    data: {
      pharmacyId,
      medicationId,
      stock,
      price,
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    },
    include: { medication: true },
  });

  console.log('Medication added:', { pharmacyId: medication.pharmacyId, medicationId: medication.medicationId });
  return {
    pharmacyId: medication.pharmacyId,
    medicationId: medication.medicationId,
    name: medication.medication.name,
    stock: medication.stock,
    price: medication.price,
    receivedDate: medication.receivedDate,
    expiryDate: medication.expiryDate,
  };
}

async function updateMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate }) {
  const medication = await prisma.pharmacyMedication.findUnique({
    where: { pharmacyId_medicationId: { pharmacyId, medicationId } },
    include: { medication: true },
  });
  if (!medication) {
    throw new Error('Medication not found');
  }

  const updatedMedication = await prisma.pharmacyMedication.update({
    where: { pharmacyId_medicationId: { pharmacyId, medicationId } },
    data: {
      stock,
      price,
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    },
    include: { medication: true },
  });

  console.log('Medication updated:', { pharmacyId: updatedMedication.pharmacyId, medicationId: updatedMedication.medicationId });
  return {
    pharmacyId: updatedMedication.pharmacyId,
    medicationId: updatedMedication.medicationId,
    name: updatedMedication.medication.name,
    stock: updatedMedication.stock,
    price: updatedMedication.price,
    receivedDate: updatedMedication.receivedDate,
    expiryDate: updatedMedication.expiryDate,
  };
}

async function deleteMedication(pharmacyId, medicationId) {
  const medication = await prisma.pharmacyMedication.findUnique({
    where: { pharmacyId_medicationId: { pharmacyId, medicationId } },
  });
  if (!medication) {
    throw new Error('Medication not found');
  }

  await prisma.pharmacyMedication.delete({
    where: { pharmacyId_medicationId: { pharmacyId, medicationId } },
  });

  console.log('Medication deleted:', { pharmacyId, medicationId });
}

async function fetchUsers(pharmacyId) {
  const users = await prisma.pharmacyUser.findMany({
    where: { pharmacyId },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log('Users fetched:', { pharmacyId, userCount: users.length });
  return users;
}

async function registerDevice(pharmacyId, deviceToken) {
  await prisma.pharmacy.update({
    where: { id: pharmacyId },
    data: { deviceToken },
  });
  console.log('Device registered:', { pharmacyId });
}

async function getProfile(userId, pharmacyId) {
  const user = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { id: true, name: true, address: true, lga: true, state: true, ward: true, phone: true, licenseNumber: true, status: true, logoUrl: true },
  });
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }

  console.log('Profile fetched:', { userId, pharmacyId });

  return { user, pharmacy };
}

async function editProfile({ user, pharmacy }, userId, pharmacyId) {
  validateLocation(pharmacy.state, pharmacy.lga, pharmacy.ward, pharmacy.latitude, pharmacy.longitude);

  const existingUser = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
  });
  if (user.email !== existingUser.email) {
    const emailConflict = await prisma.pharmacyUser.findUnique({
      where: { email: user.email },
    });
    if (emailConflict) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
    }
  }

  const result = await prisma.$transaction(async (prisma) => {
    const updatedUser = await prisma.pharmacyUser.update({
      where: { id: userId },
      data: { name: user.name, email: user.email },
    });

    const updatedPharmacy = await prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: {
        name: pharmacy.name,
        address: pharmacy.address,
        lga: pharmacy.lga,
        state: pharmacy.state,
        ward: pharmacy.ward,
        phone: pharmacy.phone,
        logoUrl: pharmacy.logoUrl || null,
      },
    });

    await prisma.$queryRaw`
      UPDATE "Pharmacy"
      SET location = ST_SetSRID(ST_MakePoint(${pharmacy.longitude}, ${pharmacy.latitude}), 4326)
      WHERE id = ${pharmacyId}
    `;

    return { user: updatedUser, pharmacy: updatedPharmacy };
  });

  console.log('Profile updated:', { userId, pharmacyId });

  return { updatedUser: result.user, updatedPharmacy: result.pharmacy };
}

async function getDashboardData(pharmacyId) {
  // Orders placed today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Orders today - only count orders with status confirmed and above
  const ordersToday = await prisma.order.count({
    where: {
      items: { some: { pharmacyMedication: { pharmacyId } } },
      status: { 
        notIn: ['cart', 'pending', 'pending_prescription'] 
      },
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
  });

  // Pending orders - count confirmed orders (shown as pending in UI)
  const pendingOrders = await prisma.order.count({
    where: {
      items: { some: { pharmacyMedication: { pharmacyId } } },
      status: 'confirmed',
    },
  });

  // Inventory alerts (stock < 10)
  const inventoryAlerts = await prisma.pharmacyMedication.count({
    where: { pharmacyId, stock: { lt: 10 } },
  });

  // Revenue today - only count orders with status confirmed and above
  const revenueTodayResult = await prisma.order.aggregate({
    _sum: { totalPrice: true },
    where: {
      items: { some: { pharmacyMedication: { pharmacyId } } },
      status: { 
        notIn: ['cart', 'pending', 'pending_prescription'] 
      },
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
  });
  const revenueToday = revenueTodayResult._sum.totalPrice || 0;

  return { ordersToday, pendingOrders, inventoryAlerts, revenueToday };
}

module.exports = {
  fetchOrders,
  updateOrderStatus,
  fetchMedications,
  addMedication,
  updateMedication,
  deleteMedication,
  fetchUsers,
  registerDevice,
  getProfile,
  editProfile,
  getDashboardData,
};