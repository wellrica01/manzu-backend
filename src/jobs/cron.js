// cleanupOrders.js
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { expirePrescriptions, sendExpiryWarnings } = require('./expire-prescriptions');
const { reconcilePreviousDay } = require('../services/reconciliationService');


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
  STOCK_RESERVATION: 0.5, // 30 minutes for abandoned checkouts
};

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds

// ⚠️ MOVE THIS HERE - BEFORE IT'S USED
const TIMEZONE = 'Africa/Lagos';

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

/**
 * ✅ CRITICAL: Cleanup abandoned checkout sessions (stock reservation timeout)
 * Restores stock for orders that were created during checkout but payment was never initiated
 * Runs every 15 minutes to aggressively reclaim reserved stock
 */
async function cleanupAbandonedCheckouts() {
  return cleanupOrders({
    status: 'PENDING',
    timeoutHours: ORDER_TIMEOUTS.STOCK_RESERVATION,
    cancelReason: 'Checkout session abandoned - stock reservation expired',
  });
}

/**
 * Cleanup old processed webhooks (keep last 30 days)
 */
async function cleanupOldWebhooks() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const result = await prisma.processedWebhook.deleteMany({
      where: {
        processedAt: { lte: thirtyDaysAgo }
      }
    });
    
    logger.info('Old webhooks cleaned up:', { deletedCount: result.count });
  } catch (error) {
    logger.error('Webhook cleanup failed:', { message: error.message });
    await alertAdmin('Webhook cleanup failed', error);
  }
}

// NOW TIMEZONE IS DEFINED, SO THESE WILL WORK:

// Expire prescriptions daily at 1 AM
cron.schedule('0 1 * * *', expirePrescriptions, { timezone: TIMEZONE });

// Send expiry warnings daily at 9 AM
cron.schedule('0 9 * * *', sendExpiryWarnings, { timezone: TIMEZONE });

// Timezone-aware cron: runs daily at midnight Lagos time
cron.schedule('0 0 * * *', cleanupPendingPrescriptionOrders, { timezone: TIMEZONE });
cron.schedule('0 0 * * *', cleanupPendingPaymentOrders, { timezone: TIMEZONE });
cron.schedule('0 2 * * *', cleanupOldWebhooks, { timezone: TIMEZONE }); // Run at 2 AM daily

// ✅ CRITICAL: Run every 15 minutes to restore stock from abandoned checkouts
cron.schedule('*/15 * * * *', cleanupAbandonedCheckouts, { timezone: TIMEZONE });

// Run daily at 3 AM
cron.schedule('0 3 * * *', async () => {
  try {
    console.log('\n🔄 Starting daily payment reconciliation...');
    await reconcilePreviousDay();
  } catch (error) {
    console.error('❌ Daily reconciliation failed:', error.message);
  }
}, { timezone: TIMEZONE });

console.log('✅ Payment reconciliation job initialized (Daily 3:00 AM)');



// Initialize refund processing jobs
const { initializeRefundJobs } = require('./process-refunds');
initializeRefundJobs();


// Initialize payout processing jobs
const { initializePayoutJobs } = require('./process-payouts');
initializePayoutJobs();

console.log('✅ Payout processing jobs initialized (Daily 11:00 PM)');


// Initialize database backup jobs
const { initializeBackupJobs } = require('./backup-database');
initializeBackupJobs();

// Optional immediate run on startup (controlled by env variable)
if (process.env.RUN_CLEANUP_ON_STARTUP === 'true') {
  cleanupPendingPrescriptionOrders();
  cleanupPendingPaymentOrders();
}

module.exports = {
  cleanupPendingPrescriptionOrders,
  cleanupPendingPaymentOrders,
  cleanupAbandonedCheckouts,
  cleanupOldWebhooks,
  expirePrescriptions,   
  sendExpiryWarnings,
};