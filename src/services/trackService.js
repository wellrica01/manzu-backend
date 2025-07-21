const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function trackOrders(trackingCode) {
  console.log('Searching for orders by tracking code:', { trackingCode });

  const orders = await prisma.order.findMany({
    where: {
      trackingCode,
      status: {
        in: [
          'CONFIRMED',
          'PROCESSING',
          'SHIPPED',
          'DELIVERED',
          'READY_FOR_PICKUP',
          'CANCELLED',
        ],
      },
    },
    select: {
      id: true,
      userIdentifier: true,
      name: true,
      totalPrice: true,
      address: true,
      deliveryMethod: true,
      trackingCode: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      updatedAt: true,
      filledAt: true,
      cancelledAt: true,
      cancelReason: true,
      prescriptionId: true,
      prescription: {
        select: {
          id: true,
          status: true,
          fileUrl: true,
          createdAt: true,
          prescriptionMedications: {
            select: {
              medicationId: true,
              quantity: true,
              medication: {
                select: {
                  brandName: true,
                  genericMedication: { select: { name: true } },
                  strengthValue: true,
                  strengthUnit: true,
                  form: true,
                },
              },
            },
          },
        },
      },
      pharmacy: {
        select: { id: true, name: true, address: true },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          medicationAvailability: {
            select: {
              medication: {
                select: {
                  id: true,
                  brandName: true,
                  genericMedication: { select: { name: true } },
                  strengthValue: true,
                  strengthUnit: true,
                  form: true,
                },
              },
              pharmacy: {
                select: { name: true, address: true },
              },
              receivedDate: true,
              expiryDate: true,
            },
          },
        },
      },
    },
  });

  if (orders.length === 0) {
    console.error('Orders not found for tracking code:', { trackingCode });
    throw new Error('Orders not found or not ready for tracking');
  }

  console.log('Orders found:', { orderIds: orders.map(o => o.id), trackingCode, status: orders.map(o => o.status) });

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
            createdAt: order.prescription.createdAt,
            medications: order.prescription.prescriptionMedications.map(pm => ({
              medicationId: pm.medicationId,
              brandName: pm.medication.brandName,
              genericName: pm.medication.genericMedication?.name,
              strengthValue: pm.medication.strengthValue,
              strengthUnit: pm.medication.strengthUnit,
              form: pm.medication.form,
              quantity: pm.quantity,
            })),
          }
        : null,
      pharmacy: order.pharmacy
        ? {
            id: order.pharmacy.id,
            name: order.pharmacy.name,
            address: order.pharmacy.address,
          }
        : null,
      items: order.items.map(item => ({
        id: item.id,
        medication: item.medicationAvailability && item.medicationAvailability.medication
          ? {
              id: item.medicationAvailability.medication.id,
              brandName: item.medicationAvailability.medication.brandName,
              genericName: item.medicationAvailability.medication.genericMedication?.name,
              strengthValue: item.medicationAvailability.medication.strengthValue,
              strengthUnit: item.medicationAvailability.medication.strengthUnit,
              form: item.medicationAvailability.medication.form,
            }
          : null,
        pharmacy: item.medicationAvailability && item.medicationAvailability.pharmacy
          ? {
              name: item.medicationAvailability.pharmacy.name,
              address: item.medicationAvailability.pharmacy.address,
            }
          : null,
        quantity: item.quantity,
        price: item.price,
        receivedDate: item.medicationAvailability?.receivedDate,
        expiryDate: item.medicationAvailability?.expiryDate,
      })),
    })),
  };
}

module.exports = { trackOrders };