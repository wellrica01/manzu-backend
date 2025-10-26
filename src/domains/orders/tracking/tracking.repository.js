/**
 * TRACKING REPOSITORY
 * 
 * Database access layer for order tracking
 * Separates data access from business logic
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find orders by tracking code
 * 
 * @param {string} trackingCode - Order tracking code
 * @returns {Promise<Array>} Orders with full details
 */
async function findOrdersByTrackingCode(trackingCode) {
  return await prisma.order.findMany({
    where: {
      trackingCode,
      status: {
        in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED'],
      },
    },
    include: {
      OrderItem: {
        include: {
          MedicationAvailability: {
            include: {
              Medication: {
                include: {
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: {
                          strengthValue: true,
                          strengthUnit: true,
                          perUnitValue: true,
                          perUnitType: true,
                          ActiveSubstance: { select: { name: true } },
                        },
                      },
                    },
                  },
                },
              },
              Pharmacy: true,
            },
          },
        },
      },
      Prescription: {
        include: {
          PrescriptionMedication: {
            include: {
              Medication: {
                include: {
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: {
                          strengthValue: true,
                          strengthUnit: true,
                          perUnitValue: true,
                          perUnitType: true,
                          ActiveSubstance: { select: { name: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      Pharmacy: true,
      Refund: true,
    },
  });
}

module.exports = {
  findOrdersByTrackingCode,
};