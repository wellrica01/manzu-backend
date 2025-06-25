const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function trackOrders(trackingCode) {
  console.log('Searching for orders by tracking code:', { trackingCode });

  const orders = await prisma.order.findMany({
    where: {
      trackingCode,
      status: {
        in: ['confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled', 'sample_collected', 'result_ready', 'completed'],
      },
    },
    select: {
      id: true,
      patientIdentifier: true,
      totalPrice: true,
      address: true,
      deliveryMethod: true,
      fulfillmentType: true,
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
          verified: true,
          createdAt: true,
          prescriptionServices: {
            select: {
              serviceId: true,
              quantity: true,
              service: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  genericName: true,
                  dosage: true,
                  description: true,
                  prescriptionRequired: true,
                },
              },
            },
          },
        },
      },
      provider: {
        select: { id: true, name: true, address: true },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          providerService: {
            select: {
              service: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  genericName: true,
                  dosage: true,
                  description: true,
                  prescriptionRequired: true,
                },
              },
              provider: {
                select: { name: true, address: true },
              },
              receivedDate: true,
              expiryDate: true,
              available: true,
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
      patientIdentifier: order.patientIdentifier,
      totalPrice: order.totalPrice,
      address: order.address,
      deliveryMethod: order.deliveryMethod,
      fulfillmentType: order.fulfillmentType,
      trackingCode: order.trackingCode,
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      filledAt: order.filledAt,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      prescription: order.prescription ? {
        id: order.prescription.id,
        status: order.prescription.status,
        fileUrl: order.prescription.fileUrl,
        verified: order.prescription.verified,
        createdAt: order.prescription.createdAt,
        services: order.prescription.prescriptionServices.map(ps => ({
          serviceId: ps.serviceId,
          name: ps.service.name,
          type: ps.service.type,
          genericName: ps.service.genericName,
          dosage: ps.service.dosage,
          description: ps.service.description,
          quantity: ps.quantity,
        })),
      } : null,
      provider: {
        id: order.provider.id,
        name: order.provider.name,
        address: order.provider.address,
      },
      items: order.items.map(item => ({
        id: item.id,
        service: {
          id: item.providerService.service.id,
          name: item.providerService.service.name,
          type: item.providerService.service.type,
          genericName: item.providerService.service.genericName,
          dosage: item.providerService.service.dosage,
          description: item.providerService.service.description,
          prescriptionRequired: item.providerService.service.prescriptionRequired,
        },
        provider: {
          name: item.providerService.provider.name,
          address: item.providerService.provider.address,
        },
        quantity: item.quantity,
        price: item.price,
        receivedDate: item.providerService.receivedDate,
        expiryDate: item.providerService.expiryDate,
        available: item.providerService.available,
      })),
    })),
  };
}

module.exports = { trackOrders };