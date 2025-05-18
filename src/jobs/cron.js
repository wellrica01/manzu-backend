const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const prisma = new PrismaClient();

// Cleanup timed-out pending_prescription orders
const cleanupPendingPrescriptionOrders = async () => {
  try {
    const timeoutThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago

    const orders = await prisma.order.findMany({
      where: {
        status: 'pending_prescription',
        createdAt: { lte: timeoutThreshold },
      },
      include: { items: true },
    });

    if (orders.length === 0) {
      console.log('No timed-out prescription orders found');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const order of orders) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'cancelled',
            cancelReason: 'Prescription verification timeout',
            cancelledAt: new Date(),
            updatedAt: new Date(),
          },
        });

        for (const item of order.items) {
          await tx.pharmacyMedication.update({
            where: {
              pharmacyId_medicationId: {
                pharmacyId: item.pharmacyMedicationPharmacyId,
                medicationId: item.pharmacyMedicationMedicationId,
              },
            },
            data: { stock: { increment: item.quantity } },
          });
        }

        console.log('Prescription order cancelled and stock released:', { orderId: order.id });
      }
    });

    console.log('Prescription cleanup completed:', { cancelledOrders: orders.length });
  } catch (error) {
    console.error('Prescription cleanup error:', { message: error.message, stack: error.stack });
  }
};

// Cleanup timed-out pending (OTC) orders
const cleanupPendingPaymentOrders = async () => {
  try {
    const timeoutThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const orders = await prisma.order.findMany({
      where: {
        status: 'pending',
        createdAt: { lte: timeoutThreshold },
      },
      include: { items: true },
    });

    if (orders.length === 0) {
      console.log('No timed-out payment orders found');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const order of orders) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'cancelled',
            cancelReason: 'Payment timeout',
            cancelledAt: new Date(),
            updatedAt: new Date(),
          },
        });

        for (const item of order.items) {
          await tx.pharmacyMedication.update({
            where: {
              pharmacyId_medicationId: {
                pharmacyId: item.pharmacyMedicationPharmacyId,
                medicationId: item.pharmacyMedicationMedicationId,
              },
            },
            data: { stock: { increment: item.quantity } },
          });
        }

        console.log('Payment order cancelled and stock released:', { orderId: order.id });
      }
    });

    console.log('Payment cleanup completed:', { cancelledOrders: orders.length });
  } catch (error) {
    console.error('Payment cleanup error:', { message: error.message, stack: error.stack });
  }
};

// Schedule daily at midnight
cron.schedule('0 0 * * *', cleanupPendingPrescriptionOrders);
cron.schedule('0 0 * * *', cleanupPendingPaymentOrders);

// Run immediately on startup (optional)
cleanupPendingPrescriptionOrders();
cleanupPendingPaymentOrders();

module.exports = { cleanupPendingPrescriptionOrders, cleanupPendingPaymentOrders };