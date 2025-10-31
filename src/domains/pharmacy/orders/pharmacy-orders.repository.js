/**
 * PHARMACY ORDERS REPOSITORY
 * 
 * Database access layer for pharmacy order operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find orders for a pharmacy with filters and pagination
 */
async function findOrders(pharmacyId, { skip, limit, where }) {
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        createdAt: true,
        trackingCode: true,
        userIdentifier: true,
        deliveryMethod: true,
        address: true,
        status: true,
        totalPrice: true,
        pharmacyAmount: true,
        Prescription: { select: { id: true, fileUrl: true, status: true } },
        OrderItem: {
          select: {
            id: true,
            quantity: true,
            price: true,
            pharmacyId: true,
            medicationId: true,
            MedicationAvailability: {
              select: {
                Medication: {
                  select: {
                    brandName: true,
                    form: true,
                    packSizeExpression: true,
                    packSizeUnit: true,
                    Medication_MedicationIngredient: {
                      select: {
                        MedicationIngredient: {
                          select: { 
                            ActiveSubstance: { select: { name: true } },
                            strengthValue: true,
                            strengthUnit: true,
                          },
                        },
                      },
                    },
                  },
                },
                Pharmacy: { select: { name: true, address: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total };
}

/**
 * Get all order IDs for a pharmacy (for S/N mapping)
 */
async function getAllOrderIds(pharmacyId) {
  return await prisma.order.findMany({
    where: {
      OrderItem: { some: { pharmacyId } },
      status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

/**
 * Find order by ID for a pharmacy
 */
async function findOrderById(pharmacyId, orderId) {
  return await prisma.order.findFirst({
    where: { 
      id: orderId,
      OrderItem: { some: { pharmacyId } },
      status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] }
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      trackingCode: true,
      userIdentifier: true,
      deliveryMethod: true,
      address: true,
      status: true,
      totalPrice: true,
      pharmacyAmount: true,
      paymentReference: true,
      paymentStatus: true,
      paymentMethod: true,
      paymentChannel: true,
      filledAt: true,
      cancelledAt: true,
      cancelReason: true,
      Prescription: { 
        select: { 
          id: true, 
          fileUrl: true, 
          status: true,
          createdAt: true
        } 
      },
      OrderItem: {
        where: { pharmacyId },
        select: {
          id: true,
          quantity: true,
          price: true,
          pharmacyId: true,
          medicationId: true,
          MedicationAvailability: {
            select: {
              Medication: {
                select: {
                  id: true,
                  brandName: true,
                  form: true,
                  packSizeExpression: true,
                  packSizeUnit: true,
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: { 
                          ActiveSubstance: { select: { name: true } },
                          strengthValue: true,
                          strengthUnit: true,
                        },
                      },
                    },
                  },
                },
              },
              Pharmacy: { 
                select: { 
                  id: true,
                  name: true, 
                  address: true,
                  phone: true,
                  lga: true,
                  state: true,
                  ward: true
                } 
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Find order with items for status update
 */
async function findOrderForUpdate(orderId, pharmacyId) {
  return await prisma.order.findFirst({
    where: {
      id: orderId,
      OrderItem: {
        some: {
          pharmacyId,
        },
      },
    },
    include: {
      OrderItem: {
        include: {
          MedicationAvailability: {
            include: {
              Medication: {
                select: { brandName: true },
              },
            },
          },
        },
      },
      Pharmacy: {
        select: { name: true }
      }
    }
  });
}

/**
 * Update order status
 */
async function updateOrderStatus(orderId, updateData) {
  return await prisma.order.update({
    where: { id: orderId },
    data: updateData,
    include: {
      OrderItem: {
        include: {
          MedicationAvailability: {
            include: {
              Medication: {
                select: { brandName: true },
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Update order status with transaction
 */
async function updateOrderStatusWithTransaction(orderId, pharmacyId, updateData, tx) {
  return await tx.order.update({
    where: { id: orderId },
    data: updateData,
    include: {
      OrderItem: {
        where: { pharmacyId },
        include: {
          MedicationAvailability: {
            include: {
              Medication: {
                select: { brandName: true },
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Restore medication stock
 */
async function restoreStock(medicationId, pharmacyId, quantity, tx) {
  return await tx.medicationAvailability.update({
    where: {
      medicationId_pharmacyId: {
        medicationId,
        pharmacyId
      }
    },
    data: {
      stock: { increment: quantity }
    }
  });
}

/**
 * Create refund record
 */
async function createRefund(refundData, tx) {
  return await tx.refund.create({
    data: refundData
  });
}

module.exports = {
  findOrders,
  getAllOrderIds,
  findOrderById,
  findOrderForUpdate,
  updateOrderStatus,
  updateOrderStatusWithTransaction,
  restoreStock,
  createRefund,
};