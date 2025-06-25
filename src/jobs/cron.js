const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const prisma = new PrismaClient();

async function cleanupTimedOutOrders() {
  try {
    const prescriptionTimeout = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours
    const paymentTimeout = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours

    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { status: 'pending_prescription', createdAt: { lte: prescriptionTimeout } },
          { status: 'pending', createdAt: { lte: paymentTimeout } },
        ],
      },
      include: { items: true },
    });

    if (orders.length === 0) {
      console.log('No timed-out orders found');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const order of orders) {
        const cancelReason = order.status === 'pending_prescription' ? 'Prescription verification timeout' : 'Payment timeout';
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'cancelled',
            cancelReason,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          },
        });

        for (const item of order.items) {
          await tx.providerService.update({
            where: {
              providerId_serviceId: {
                providerId: item.providerServiceProviderId,
                serviceId: item.providerServiceServiceId,
              },
            },
            data: { stock: { increment: item.quantity } },
          });
        }

        console.log('Order cancelled and stock released:', { orderId: order.id, status: order.status });
      }
    });

    console.log('Order cleanup completed:', { cancelledOrders: orders.length });
  } catch (error) {
    console.error('Order cleanup error:', { message: error.message, stack: error.stack });
  }
}

// Schedule daily at midnight
cron.schedule('0 0 * * *', cleanupTimedOutOrders);

// Run immediately on startup
cleanupTimedOutOrders();

module.exports = { cleanupTimedOutOrders };