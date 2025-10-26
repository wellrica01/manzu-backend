const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const {
  capitalize,
  formatPerUnitType,
  formatPackSizeUnit,
  formatStrengthUnit,
} = require('../utils/medicationUtils');

async function trackOrders(trackingCode) {
  console.log('Searching for orders by tracking code:', { trackingCode });

  const orders = await prisma.order.findMany({
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

  if (!orders.length) throw new Error('Orders not found or not ready for tracking');

  console.log('Orders found:', { orderIds: orders.map(o => o.id), trackingCode });

  return {
    message: 'Orders found',
    orders: orders.map(order => {
      // 🟡 handle refund extraction
      const latestRefund =
        order.Refund && order.Refund.length
          ? order.Refund.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
          : null;

      return {
        id: order.id,
        name: order.name,
        userIdentifier: order.userIdentifier,
        totalPrice: order.totalPrice,
        address: order.address,
        deliveryMethod: order.deliveryMethod,
        trackingCode: order.trackingCode,
        status: order.status,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        filledAt: order.filledAt,
        cancelledAt: order.cancelledAt,
        cancelReason: order.cancelReason,

        refundStatus: latestRefund?.status || null,
        refundAmount: latestRefund?.amount
          ? parseFloat(latestRefund.amount)
          : null,
        refundDate: latestRefund?.processedAt || null,
        rejectionReason: order.cancelReason || latestRefund?.reason || null,

        // Prescription info
        prescription: order.Prescription
          ? {
              id: order.Prescription.id,
              status: order.Prescription.status,
              fileUrl: order.Prescription.fileUrl,
              verified: order.Prescription.status === 'VERIFIED',
              medications: order.Prescription.PrescriptionMedication.map(pm => {
                const med = pm.Medication;
                const ingredients = med.Medication_MedicationIngredient.map(mmi => {
                  const ingredient = mmi.MedicationIngredient;
                  return {
                    activeSubstance: ingredient.ActiveSubstance?.name || null,
                    strengthValue: ingredient.strengthValue || null,
                    strengthUnit: formatStrengthUnit(ingredient.strengthUnit),
                    perUnitValue: ingredient.perUnitValue || null,
                    perUnitType: formatPerUnitType(ingredient.perUnitType),
                  };
                });

                const displayName = med.form
                  ? `${med.brandName}${med.pharmacopeia ? ` ${med.pharmacopeia}` : ''} (${capitalize(med.form)})`
                  : med.brandName;

                return {
                  medicationId: pm.medicationId,
                  ingredients,
                  displayName,
                  quantity: pm.quantity,
                };
              }),
            }
          : null,

        // Pharmacy info
        pharmacy: order.Pharmacy
          ? { id: order.Pharmacy.id, name: order.Pharmacy.name, address: order.Pharmacy.address }
          : null,

        // Order items
        items: order.OrderItem.map(item => {
          const med = item.MedicationAvailability?.Medication;

          const ingredients =
            med?.Medication_MedicationIngredient.map(mmi => {
              const ingredient = mmi.MedicationIngredient;
              return {
                activeSubstance: ingredient.ActiveSubstance?.name || null,
                strengthValue: ingredient.strengthValue || null,
                strengthUnit: formatStrengthUnit(ingredient.strengthUnit),
                perUnitValue: ingredient.perUnitValue || null,
                perUnitType: formatPerUnitType(ingredient.perUnitType),
              };
            }) || [];

          const displayName = med
            ? med.form
              ? `${med.brandName}${med.pharmacopeia ? ` ${med.pharmacopeia}` : ''} (${capitalize(med.form)})`
              : med.brandName
            : null;

          return {
            id: item.id,
            medication: med
              ? {
                  id: med.id,
                  brandName: med.brandName,
                  prescriptionRequired: med.prescriptionRequired,
                  packSizeUnit: formatPackSizeUnit(med.packSizeUnit),
                  ingredients,
                  displayName,
                }
              : null,
            pharmacy: item.MedicationAvailability?.Pharmacy
              ? {
                  name: item.MedicationAvailability.Pharmacy.name,
                  address: item.MedicationAvailability.Pharmacy.address,
                }
              : null,
            quantity: item.quantity,
            price: item.price,
            expiryDate: item.MedicationAvailability?.expiryDate,
          };
        }),
      };
    }),
  };
}

module.exports = { trackOrders };
