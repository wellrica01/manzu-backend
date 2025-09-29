const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
    },
  });

  if (!orders.length) throw new Error('Orders not found or not ready for tracking');

  console.log('Orders found:', { orderIds: orders.map(o => o.id), trackingCode });

  return {
    message: 'Orders found',
    orders: orders.map(order => ({
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
      prescription: order.Prescription
        ? {
            id: order.Prescription.id,
            status: order.Prescription.status,
            fileUrl: order.Prescription.fileUrl,
            verified: order.Prescription.status === 'VERIFIED',
            medications: order.Prescription.PrescriptionMedications.map(pm => ({
              medicationId: pm.medicationId,
              ingredients: pm.medication.Medication_MedicationIngredient.map(mmi => ({
                activeSubstance: mmi.MedicationIngredient.ActiveSubstance?.name,
                strengthValue: mmi.MedicationIngredient.strengthValue,
                strengthUnit: mmi.MedicationIngredient.strengthUnit,
              })),
              quantity: pm.quantity,
            })),
          }
        : null,
      pharmacy: order.Pharmacy
        ? { id: order.Pharmacy.id, name: order.Pharmacy.name, address: order.Pharmacy.address }
        : null,
      items: order.OrderItem.map(item => {
        const med = item.MedicationAvailability?.Medication;
        const ingredients = med?.Medication_MedicationIngredient.map(mmi => ({
          activeSubstance: mmi.MedicationIngredient.ActiveSubstance?.name,
          strengthValue: mmi.MedicationIngredient.strengthValue,
          strengthUnit: mmi.MedicationIngredient.strengthUnit,
        }));
        const displayName = ingredients?.map(i => `${i.activeSubstance} ${i.strengthValue ?? ''}${i.strengthUnit ?? ''}`).join(' + ');

        return {
          id: item.id,
          medication: med
            ? {
                id: med.id,
                brandName: med.brandName,
                prescriptionRequired: med.prescriptionRequired,
                ingredients,
                displayName,
              }
            : null,
          pharmacy: item.MedicationAvailability?.Pharmacy
            ? { name: item.MedicationAvailability.Pharmacy.name, address: item.MedicationAvailability.Pharmacy.address }
            : null,
          quantity: item.quantity,
          price: item.price,
          expiryDate: item.MedicationAvailability?.expiryDate,
        };
      }),
    })),
  };
}

module.exports = { trackOrders };
