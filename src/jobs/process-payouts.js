/**
 * PAYOUT PROCESSING CRON JOB
 * 
 * Runs daily at 11 PM Lagos time to:
 * - Process batch payouts for all pharmacies with completed orders
 * - Alert admin for pharmacies without banking setup
 * - Handle failed payouts
 */

const cron = require('node-cron');
const payoutsService = require('../domains/pharmacy/payouts/pharmacy-payouts.service');
const payoutsRepository = require('../domains/pharmacy/payouts/pharmacy-payouts.repository');
const { reportError, ErrorCategory } = require('../utils/error-reporter');

/**
 * Process daily batch payouts for all pharmacies
 */
async function processDailyPayouts() {
  try {
    console.log('\n💰 [CRON] Starting daily payout processing...');
    console.log(`⏰ Time: ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`);

    // Get all orders grouped by pharmacy
    const pharmacyGroups = await payoutsRepository.groupOrdersByPharmacy();

    if (pharmacyGroups.length === 0) {
      console.log('✅ No orders ready for payout');
      return;
    }

    console.log(`📋 Found ${pharmacyGroups.length} pharmacies with orders ready for payout`);

    let successCount = 0;
    let failureCount = 0;
    const pharmaciesWithoutBanking = [];

    for (const group of pharmacyGroups) {
      const { pharmacy, orders, totalAmount } = group;

      console.log(`\n💊 Processing pharmacy: ${pharmacy.name} (ID: ${pharmacy.id})`);
      console.log(`   Orders: ${orders.length}, Amount: ₦${totalAmount.toFixed(2)}`);

      try {
        // Check if pharmacy has banking setup
        if (!pharmacy.recipientCode) {
          console.log(`   ⚠️  No banking setup - skipping`);
          pharmaciesWithoutBanking.push({
            id: pharmacy.id,
            name: pharmacy.name,
            orderCount: orders.length,
            amount: totalAmount,
          });
          continue;
        }

        // Process batch payout
        const orderIds = orders.map(o => o.id);
        await payoutsService.processBatchPayout(pharmacy.id, orderIds);
        
        successCount++;
        console.log(`   ✅ Payout initiated successfully`);

      } catch (error) {
        failureCount++;
        console.error(`   ❌ Payout failed: ${error.message}`);
        
        // Report error but continue with other pharmacies
        reportError(error, {
          category: ErrorCategory.SYSTEM,
          customContext: {
            job: 'daily-payout-processing',
            pharmacyId: pharmacy.id,
            pharmacyName: pharmacy.name,
            orderCount: orders.length,
            amount: totalAmount,
          },
        });
      }
    }

    // Alert admin about pharmacies without banking
    if (pharmaciesWithoutBanking.length > 0) {
      console.log(`\n⚠️  ${pharmaciesWithoutBanking.length} pharmacies without banking setup:`);
      pharmaciesWithoutBanking.forEach(p => {
        console.log(`   - ${p.name} (${p.orderCount} orders, ₦${p.amount.toFixed(2)})`);
      });

      reportError(new Error('Pharmacies without banking setup'), {
        category: ErrorCategory.SYSTEM,
        customContext: {
          job: 'daily-payout-processing',
          pharmaciesWithoutBanking,
        },
      });
    }

    console.log('\n📊 Daily payout processing complete');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log(`   ⚠️  No banking: ${pharmaciesWithoutBanking.length}`);

  } catch (error) {
    console.error('❌ Daily payout processing error:', error);
    reportError(error, {
      category: ErrorCategory.SYSTEM,
      customContext: { job: 'daily-payout-processing' },
    });
  }
}

/**
 * Retry failed payouts (runs separately from daily batch)
 */
async function retryFailedPayouts() {
  try {
    console.log('\n🔄 [CRON] Checking failed payouts for retry...');

    const failedPayouts = await payoutsRepository.getFailedPayouts();

    if (failedPayouts.length === 0) {
      console.log('✅ No failed payouts to retry');
      return;
    }

    console.log(`📋 Found ${failedPayouts.length} failed payouts`);

    for (const payout of failedPayouts) {
      try {
        console.log(`🔄 Retrying payout ${payout.id} for ${payout.Pharmacy.name}...`);
        
        await payoutsService.retryFailedPayout(payout.id);
        
        console.log(`✅ Retry initiated successfully`);
      } catch (error) {
        console.error(`❌ Retry failed for payout ${payout.id}:`, error.message);
      }
    }

    console.log('✅ Failed payouts retry complete');

  } catch (error) {
    console.error('❌ Failed payouts retry error:', error);
    reportError(error, {
      category: ErrorCategory.SYSTEM,
      customContext: { job: 'retry-failed-payouts' },
    });
  }
}

/**
 * Generate daily payout report
 */
async function generatePayoutReport() {
  try {
    console.log('\n📊 [CRON] Generating daily payout report...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get all payouts for today
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const payouts = await prisma.payout.findMany({
      where: {
        initiatedAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        Pharmacy: {
          select: {
            name: true,
          },
        },
      },
    });

    if (payouts.length === 0) {
      console.log('✅ No payouts processed today');
      return;
    }

    const summary = {
      total: payouts.length,
      completed: payouts.filter(p => p.status === 'COMPLETED').length,
      processing: payouts.filter(p => p.status === 'PROCESSING').length,
      failed: payouts.filter(p => p.status === 'FAILED').length,
      totalAmount: payouts.reduce((sum, p) => sum + parseFloat(p.amount), 0),
    };

    console.log('\n📊 Daily Payout Report:');
    console.log(`   Total payouts: ${summary.total}`);
    console.log(`   ✅ Completed: ${summary.completed}`);
    console.log(`   🔄 Processing: ${summary.processing}`);
    console.log(`   ❌ Failed: ${summary.failed}`);
    console.log(`   💰 Total amount: ₦${summary.totalAmount.toFixed(2)}`);

  } catch (error) {
    console.error('❌ Report generation error:', error);
  }
}

/**
 * Initialize payout cron jobs
 */
function initializePayoutJobs() {
  console.log('💰 Initializing payout processing cron jobs...');

  // Process daily payouts at 11 PM Lagos time
  cron.schedule('0 23 * * *', async () => {
    console.log('\n⏰ [CRON] Daily payout job triggered');
    await processDailyPayouts();
  }, { 
    timezone: 'Africa/Lagos' 
  });

  // Retry failed payouts every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    console.log('\n⏰ [CRON] Failed payouts retry job triggered');
    await retryFailedPayouts();
  }, { 
    timezone: 'Africa/Lagos' 
  });

  // Generate report at midnight (after payouts processed)
  cron.schedule('0 0 * * *', async () => {
    console.log('\n⏰ [CRON] Daily report generation triggered');
    await generatePayoutReport();
  }, { 
    timezone: 'Africa/Lagos' 
  });

  console.log('✅ Payout cron jobs initialized');
  console.log('   - Daily payouts: Every day at 11:00 PM');
  console.log('   - Failed retry: Every 2 hours');
  console.log('   - Daily report: Every day at 12:00 AM');
}

module.exports = {
  initializePayoutJobs,
  processDailyPayouts,
  retryFailedPayouts,
  generatePayoutReport,
};