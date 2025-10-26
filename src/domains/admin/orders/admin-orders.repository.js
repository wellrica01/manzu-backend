/**
 * ADMIN ORDERS REPOSITORY
 * 
 * Database access layer for admin order management
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find orders with filters and pagination
 */
async function findOrders({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        userIdentifier: true,
        status: true,
        totalPrice: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip,
    }),
    prisma.order.count({ where }),
  ]);
}

/**
 * Find order by ID with full details
 */
async function findOrderById(id) {
  return await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      userIdentifier: true,
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
      createdAt: true,
      updatedAt: true,
      Pharmacy: {
        select: { id: true, name: true },
      },
      Prescription: {
        select: {
          id: true,
          userIdentifier: true,
          status: true,
          fileUrl: true,
        },
      },
      OrderItem: {
        select: {
          MedicationAvailability: {
            select: {
              Medication: {
                select: {
                  id: true,
                  brandName: true,
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: {
                          id: true,
                          strengthValue: true,
                          strengthUnit: true,
                          perUnitValue: true,
                          perUnitType: true,
                          ActiveSubstance: {
                            select: { id: true, name: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
              Pharmacy: {
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
}

module.exports = {
  findOrders,
  findOrderById,
};