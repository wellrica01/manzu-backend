const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fetchOrders(pharmacyId) {
  const orders = await prisma.order.findMany({
    where: {
      items: {
        some: {
          pharmacyMedication: {
            pharmacyId,
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
      deliveryMethod: true,
      address: true,
      status: true,
      totalPrice: true,
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
  });

  return orders.map(order => ({
    id: order.id,
    createdAt: order.createdAt,
    trackingCode: order.trackingCode,
    patientIdentifier: order.patientIdentifier,
    deliveryMethod: order.deliveryMethod,
    address: order.address,
    status: order.status,
    totalPrice: order.totalPrice,
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
  }));
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

module.exports = {
  fetchOrders,
  updateOrderStatus,
  fetchMedications,
  addMedication,
  updateMedication,
  deleteMedication,
  fetchUsers,
  registerDevice,
};