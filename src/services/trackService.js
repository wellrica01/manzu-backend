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
      items: {
        include: {
          medicationAvailability: {
            include: {
              medication: {
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
              pharmacy: true,
              receivedDate: true,
              expiryDate: true,
            },
          },
        },
      },
      prescription: {
        include: {
          prescriptionMedications: {
            include: {
              medication: {
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
      pharmacy: true,
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
      prescription: order.prescription
        ? {
            id: order.prescription.id,
            status: order.prescription.status,
            fileUrl: order.prescription.fileUrl,
            verified: order.prescription.status === 'VERIFIED',
            medications: order.prescription.prescriptionMedications.map(pm => ({
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
      pharmacy: order.pharmacy
        ? { id: order.pharmacy.id, name: order.pharmacy.name, address: order.pharmacy.address }
        : null,
      items: order.items.map(item => {
        const med = item.medicationAvailability?.medication;
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
          pharmacy: item.medicationAvailability?.pharmacy
            ? { name: item.medicationAvailability.pharmacy.name, address: item.medicationAvailability.pharmacy.address }
            : null,
          quantity: item.quantity,
          price: item.price,
          receivedDate: item.medicationAvailability?.receivedDate,
          expiryDate: item.medicationAvailability?.expiryDate,
        };
      }),
    })),
  };
}

module.exports = { trackOrders };
