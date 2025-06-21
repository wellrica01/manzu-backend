const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { recalculateOrderTotal } = require('../utils/cartUtils');
const prisma = new PrismaClient();

async function addToCart({ medicationId, pharmacyId, quantity, userId }) {
  // Generate userId if not provided
  userId = userId || uuidv4();

  // Check if pharmacy exists
  const pharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacyId } });
  if (!pharmacy) {
    throw new Error('Pharmacy not found');
  }

  // Check if an order already exists for this user
  let order = await prisma.order.findFirst({
    where: {
      patientIdentifier: userId,
      status: { in: ['pending_prescription', 'pending', 'cart'] },
    },
  });

  // If order exists and isn't in 'cart' status, update it
  if (order) {
    if (order.status !== 'cart') {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'cart' },
      });
    }
  } else {
    // If no order exists, create a new one
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

  // Check if the medication is available at the selected pharmacy with sufficient stock
  const pharmacyMedication = await prisma.pharmacyMedication.findFirst({
    where: { medicationId, pharmacyId, stock: { gte: quantity } },
  });

  if (!pharmacyMedication) {
    throw new Error('Medication not available at this pharmacy or insufficient stock');
  }

  // Perform order item creation/update and total recalculation in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const orderItem = await tx.orderItem.upsert({
      where: {
        orderId_pharmacyMedicationPharmacyId_pharmacyMedicationMedicationId: {
          orderId: order.id,
          pharmacyMedicationPharmacyId: pharmacyId,
          pharmacyMedicationMedicationId: medicationId,
        },
      },
      update: {
        quantity: { increment: quantity },
        price: pharmacyMedication.price,
      },
      create: {
        orderId: order.id,
        pharmacyMedicationPharmacyId: pharmacyId,
        pharmacyMedicationMedicationId: medicationId,
        quantity,
        price: pharmacyMedication.price,
      },
    });

    const { updatedOrder } = await recalculateOrderTotal(tx, order.id);

    return { orderItem, order: updatedOrder };
  });

  console.log('Created/Updated OrderItem:', result.orderItem);
  return { orderItem: result.orderItem, userId };
}

async function getCart(userId) {
  const order = await prisma.order.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
    include: {
      items: {
        include: {
          pharmacyMedication: {
            include: {
              pharmacy: true,
              medication: true,
            },
          },
        },
      },
      prescription: true,
    },
  });

  if (!order) {
    return { items: [], totalPrice: 0, pharmacies: [] };
  }

  const pharmacyGroups = order.items.reduce((acc, item) => {
    const pharmacyId = item.pharmacyMedication?.pharmacy?.id;
    if (!pharmacyId) return acc; // Skip if data is incomplete

    if (!acc[pharmacyId]) {
      acc[pharmacyId] = {
        pharmacy: {
          id: pharmacyId,
          name: item.pharmacyMedication?.pharmacy?.name ?? "Unknown Pharmacy",
          address: item.pharmacyMedication?.pharmacy?.address ?? "No address",
        },
        items: [],
        subtotal: 0,
      };
    }

    acc[pharmacyId].items.push({
      id: item.id,
      medication: {
        name: item.pharmacyMedication?.medication?.name ?? "Unknown",
        displayName: `${item.pharmacyMedication?.medication?.name ?? ""}${item.pharmacyMedication?.medication?.dosage ? ` ${item.pharmacyMedication.medication.dosage}` : ''}${item.pharmacyMedication?.medication?.form ? ` (${item.pharmacyMedication.medication.form})` : ''}`,
        category: item.pharmacyMedication?.medication?.category,
        prescriptionRequired: item.pharmacyMedication?.medication?.prescriptionRequired ?? false,
      },
      quantity: item.quantity,
      price: item.price,
      pharmacyMedicationMedicationId: item.pharmacyMedicationMedicationId,
      pharmacyMedicationPharmacyId: item.pharmacyMedicationPharmacyId,
    });

    acc[pharmacyId].subtotal += item.quantity * item.price;
    return acc;
  }, {});

  const pharmacies = Object.values(pharmacyGroups);
  const totalPrice = pharmacies.reduce((sum, p) => sum + p.subtotal, 0);

  console.log('GET /api/cart response:', { pharmacies, totalPrice });

  return {
    pharmacies,
    totalPrice,
    prescriptionId: order.prescriptionId ?? order.prescription?.id ?? null,
  };
}


async function updateCartItem({ orderItemId, quantity, userId }) {
  const order = await prisma.order.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!order) {
    throw new Error('Cart not found');
  }

  const orderItem = await prisma.orderItem.findFirst({
    where: { id: orderItemId, orderId: order.id },
    include: { pharmacyMedication: true },
  });
  if (!orderItem) {
    throw new Error('Item not found');
  }

  const pharmacyMedication = await prisma.pharmacyMedication.findFirst({
    where: {
      medicationId: orderItem.pharmacyMedicationMedicationId,
      pharmacyId: orderItem.pharmacyMedicationPharmacyId,
      stock: { gte: quantity },
    },
  });
  if (!pharmacyMedication) {
    throw new Error('Insufficient stock');
  }

  // Perform order item update and total recalculation in a transaction
  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { quantity, price: pharmacyMedication.price },
    });

    await recalculateOrderTotal(tx, order.id);

    return item;
  });

  return updatedItem;
}

async function removeFromCart({ orderItemId, userId }) {
  const order = await prisma.order.findFirst({
    where: { patientIdentifier: userId, status: 'cart' },
  });
  if (!order) {
    throw new Error('Cart not found');
  }

  // Perform order item deletion and total recalculation in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.delete({
      where: { id: orderItemId, orderId: order.id },
    });

    await recalculateOrderTotal(tx, order.id);
  });
}

module.exports = {
  addToCart,
  getCart,
  updateCartItem,
  removeFromCart,
};