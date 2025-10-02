// cleanupOrders.js
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();

// Placeholder logger; replace with structured logger in production
const logger = {
  info: console.log,
  error: console.error,
};

// Configurable timeouts (in hours)
const ORDER_TIMEOUTS = {
  PRESCRIPTION: 48, // hours
  PAYMENT: 24,      // hours
};

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds

// Placeholder alert function (replace with email/Slack integration)
async function alertAdmin(message, error) {
  logger.error('ALERT ADMIN:', message, { message: error.message, stack: error.stack });
}

/**
 * Generic cleanup function with retry logic
 */
async function cleanupOrders({ status, timeoutHours, cancelReason }) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const timeoutThreshold = new Date(Date.now() - timeoutHours * 60 * 60 * 1000);

      const orders = await prisma.order.findMany({
        where: { status, createdAt: { lte: timeoutThreshold } },
        include: { OrderItem: true },
      });

      if (!orders.length) {
        logger.info(`No timed-out orders found for status: ${status}`);
        return;
      }

      // Batch transaction
      await prisma.$transaction(
        orders.map((order) => [
          prisma.order.update({
            where: { id: order.id, status }, // atomic update
            data: {
              status: 'CANCELLED',
              cancelReason,
              cancelledAt: new Date(),
              updatedAt: new Date(),
            },
          }),
          ...order.OrderItem.map((item) =>
            prisma.medicationAvailability.update({
              where: { medicationId_pharmacyId: { medicationId: item.medicationId, pharmacyId: item.pharmacyId } },
              data: { stock: { increment: item.quantity } },
            })
          ),
        ]).flat()
      );

      logger.info(`Order cleanup completed for status ${status}`, { cancelledOrders: orders.length });
      return; // success
    } catch (error) {
      attempt++;
      logger.error(`Cleanup attempt ${attempt} failed for status ${status}`, { message: error.message });
      if (attempt >= MAX_RETRIES) {
        await alertAdmin(`Order cleanup failed for status ${status} after ${MAX_RETRIES} attempts`, error);
        return;
      }
      await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

// Specific cleanup tasks
async function cleanupPendingPrescriptionOrders() {
  return cleanupOrders({
    status: 'PENDING_PRESCRIPTION',
    timeoutHours: ORDER_TIMEOUTS.PRESCRIPTION,
    cancelReason: 'Prescription verification timeout',
  });
}

async function cleanupPendingPaymentOrders() {
  return cleanupOrders({
    status: 'PENDING',
    timeoutHours: ORDER_TIMEOUTS.PAYMENT,
    cancelReason: 'Payment timeout',
  });
}

// Timezone-aware cron: runs daily at midnight Lagos time
const TIMEZONE = 'Africa/Lagos';
cron.schedule('0 0 * * *', cleanupPendingPrescriptionOrders, { timezone: TIMEZONE });
cron.schedule('0 0 * * *', cleanupPendingPaymentOrders, { timezone: TIMEZONE });

// Optional immediate run on startup (controlled by env variable)
if (process.env.RUN_CLEANUP_ON_STARTUP === 'true') {
  cleanupPendingPrescriptionOrders();
  cleanupPendingPaymentOrders();
}

module.exports = {
  cleanupPendingPrescriptionOrders,
  cleanupPendingPaymentOrders,
};
