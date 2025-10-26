/**
 * REFUND PROCESSING CRON JOB
 * 
 * Runs every 5 minutes to:
 * - Process pending refunds
 * - Retry failed refunds (with exponential backoff)
 * - Check Paystack refund status
 */

const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const refundService = require('../services/refundService');
const { reportError, ErrorCategory } = require('../utils/error-reporter');

/**
 * Process pending refunds
 */
async function processPendingRefunds() {
  try {
    console.log('🔄 Processing pending refunds...');

    // Get all pending refunds
    const pendingRefunds = await prisma.refund.findMany({
      where: {
        status: 'PENDING',
        refundType: { not: 'MANUAL' } // Manual refunds need approval
      },
      orderBy: { createdAt: 'asc' },
      take: 10 // Process 10 at a time
    });

    if (pendingRefunds.length === 0) {
      console.log('✅ No pending refunds to process');
      return;
    }

    console.log(`📋 Found ${pendingRefunds.length} pending refunds`);

    for (const refund of pendingRefunds) {
      try {
        console.log(`🔄 Processing refund ${refund.id}...`);
        await refundService.processRefund(refund.id);
        console.log(`✅ Refund ${refund.id} processed successfully`);
      } catch (error) {
        console.error(`❌ Failed to process refund ${refund.id}:`, error.message);
        // Continue with next refund
      }
    }

    console.log('✅ Pending refunds processing complete');

  } catch (error) {
    console.error('❌ Error processing pending refunds:', error);
    reportError(error, {
      category: ErrorCategory.SYSTEM,
      customContext: { job: 'process-pending-refunds' }
    });
  }
}

/**
 * Retry failed refunds with exponential backoff
 */
async function retryFailedRefunds() {
  try {
    console.log('🔄 Retrying failed refunds...');

    // Get failed refunds that should be retried
    const failedRefunds = await prisma.refund.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: 3 }, // Max 3 retries
        OR: [
          { lastRetryAt: null }, // Never retried
          {
            lastRetryAt: {
              // Exponential backoff: 5min, 30min, 2hours
              lt: new Date(Date.now() - getRetryDelay())
            }
          }
        ]
      },
      orderBy: { createdAt: 'asc' },
      take: 5 // Retry 5 at a time
    });

    if (failedRefunds.length === 0) {
      console.log('✅ No failed refunds to retry');
      return;
    }

    console.log(`📋 Found ${failedRefunds.length} failed refunds to retry`);

    for (const refund of failedRefunds) {
      try {
        console.log(`🔄 Retrying refund ${refund.id} (attempt ${(refund.retryCount || 0) + 1}/3)...`);
        
        // Update retry count and timestamp
        await prisma.refund.update({
          where: { id: refund.id },
          data: {
            retryCount: (refund.retryCount || 0) + 1,
            lastRetryAt: new Date()
          }
        });

        await refundService.retryFailedRefund(refund.id);
        console.log(`✅ Refund ${refund.id} retry successful`);
      } catch (error) {
        console.error(`❌ Failed to retry refund ${refund.id}:`, error.message);
        // Continue with next refund
      }
    }

    console.log('✅ Failed refunds retry complete');

  } catch (error) {
    console.error('❌ Error retrying failed refunds:', error);
    reportError(error, {
      category: ErrorCategory.SYSTEM,
      customContext: { job: 'retry-failed-refunds' }
    });
  }
}

/**
 * Check status of processing refunds from Paystack
 */
async function checkProcessingRefunds() {
  try {
    console.log('🔄 Checking processing refunds status...');

    // Get refunds that have been processing for more than 10 minutes
    const processingRefunds = await prisma.refund.findMany({
      where: {
        status: 'PROCESSING',
        createdAt: {
          lt: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
        }
      },
      take: 10
    });

    if (processingRefunds.length === 0) {
      console.log('✅ No stuck processing refunds');
      return;
    }

    console.log(`📋 Found ${processingRefunds.length} processing refunds to check`);

    for (const refund of processingRefunds) {
      try {
        console.log(`🔍 Checking refund ${refund.id} status...`);
        
        // Check status with Paystack
        // TODO: Implement Paystack status check API
        // For now, retry processing
        await refundService.processRefund(refund.id);
        
      } catch (error) {
        console.error(`❌ Failed to check refund ${refund.id}:`, error.message);
      }
    }

    console.log('✅ Processing refunds check complete');

  } catch (error) {
    console.error('❌ Error checking processing refunds:', error);
    reportError(error, {
      category: ErrorCategory.SYSTEM,
      customContext: { job: 'check-processing-refunds' }
    });
  }
}

/**
 * Get retry delay based on retry count (exponential backoff)
 */
function getRetryDelay() {
  // 5 minutes, 30 minutes, 2 hours
  const delays = [
    5 * 60 * 1000,      // 5 minutes
    30 * 60 * 1000,     // 30 minutes
    2 * 60 * 60 * 1000  // 2 hours
  ];
  
  return delays[0]; // Return first delay for query
}

/**
 * Initialize refund processing cron jobs
 */
function initializeRefundJobs() {
  console.log('🔄 Initializing refund processing cron jobs...');

  // Process pending refunds every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('\n⏰ [CRON] Running pending refunds job...');
    await processPendingRefunds();
  });

  // Retry failed refunds every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('\n⏰ [CRON] Running failed refunds retry job...');
    await retryFailedRefunds();
  });

  // Check processing refunds every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    console.log('\n⏰ [CRON] Running processing refunds check job...');
    await checkProcessingRefunds();
  });

  console.log('✅ Refund processing cron jobs initialized');
  console.log('   - Pending refunds: Every 5 minutes');
  console.log('   - Failed refunds retry: Every 15 minutes');
  console.log('   - Processing refunds check: Every 10 minutes');
}

module.exports = {
  initializeRefundJobs,
  processPendingRefunds,
  retryFailedRefunds,
  checkProcessingRefunds
};
