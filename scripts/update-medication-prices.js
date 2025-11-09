/**
 * Medication Availability Price Update Script
 * Updates prices in MedicationAvailability for pharmacies 1-9 by multiplying by 100.
 * Assumes all records for these pharmacies were added with incorrect prices.
 * 
 * Usage:
 *   node update-medication-prices.js [--dry-run] [--batch-size=100]
 */

const fs = require('fs').promises;
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?pgbouncer=true&statement_cache_size=0'
    }
  }
});

// Configuration
const CONFIG = {
  dryRun: process.argv.includes('--dry-run'),
  batchSize: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 100,
  pharmacyIdRange: { min: 1, max: 9 },
};

// Results tracking
const results = {
  totalPharmacies: 0,
  processed: 0,
  successful: 0,
  failed: 0,
  updatesPerformed: 0,
  errors: [],
  warnings: [],
};

/**
 * Process updates for a single pharmacy
 */
async function processPharmacy(pharmacyId) {
  try {
    // Get all availability records for this pharmacy
    const availabilities = await prisma.medicationAvailability.findMany({
      where: { pharmacyId },
      select: {
        medicationId: true,
        price: true,
      },
    });

    if (availabilities.length === 0) {
      results.warnings.push(`Pharmacy ${pharmacyId}: No records found`);
      results.successful += 1;
      return;
    }

    if (CONFIG.dryRun) {
      console.log(`[DRY RUN] Would update ${availabilities.length} records for pharmacy ${pharmacyId}`);
      results.successful += 1;
      results.updatesPerformed += availabilities.length;
      return;
    }

    // Update in batches
    for (let i = 0; i < availabilities.length; i += CONFIG.batchSize) {
      const batch = availabilities.slice(i, i + CONFIG.batchSize);
      const updatePromises = batch.map(avail => 
        prisma.medicationAvailability.update({
        where: {
            medicationId_pharmacyId: {  // ✅ Correct order
            medicationId: avail.medicationId,
            pharmacyId,
            },
        },
        data: {
            price: avail.price * 100,
        },
        })
      );

      await Promise.all(updatePromises);
    }

    results.updatesPerformed += availabilities.length;
    results.successful += 1;
    console.log(`✓ Pharmacy ${pharmacyId}: Updated ${availabilities.length} records`);

  } catch (error) {
    console.error(`✗ Pharmacy ${pharmacyId} failed:`, error.message);
    results.failed += 1;
    results.errors.push({
      pharmacyId,
      errors: [`Processing failed: ${error.message}`],
    });
  }
}

/**
 * Generate and save report
 */
async function generateReport() {
  const report = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    summary: {
      totalPharmacies: results.totalPharmacies,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      updatesPerformed: results.updatesPerformed,
      successRate: ((results.successful / results.totalPharmacies) * 100).toFixed(2) + '%',
    },
    warnings: results.warnings,
    errors: results.errors,
  };
  
  const reportPath = `price-update-report-${Date.now()}.json`;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('PRICE UPDATE SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Pharmacies:   ${results.totalPharmacies}`);
  console.log(`Processed:          ${results.processed}`);
  console.log(`✓ Successful:       ${results.successful}`);
  console.log(`✗ Failed:           ${results.failed}`);
  console.log(`Updates:            ${results.updatesPerformed}`);
  console.log(`Success Rate:       ${report.summary.successRate}`);
  console.log(`\n⚠  Warnings:         ${results.warnings.length}`);
  console.log(`✗ Errors:           ${results.errors.length}`);
  console.log('\n' + '='.repeat(60));
  console.log(`Report saved to: ${reportPath}`);
  
  if (results.errors.length > 0) {
    console.log('\nFirst 5 errors:');
    results.errors.slice(0, 5).forEach((err, i) => {
      console.log(`${i + 1}. Pharmacy ${err.pharmacyId}`);
      err.errors.forEach(e => console.log(`   • ${e}`));
    });
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('MEDICATION AVAILABILITY PRICE UPDATE SCRIPT');
  console.log('='.repeat(60));
  console.log(`Mode:        ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch Size:  ${CONFIG.batchSize}`);
  console.log(`Pharm Range: ${CONFIG.pharmacyIdRange.min}-${CONFIG.pharmacyIdRange.max}`);
  console.log('='.repeat(60) + '\n');
  
  try {
    // Calculate total pharmacies
    results.totalPharmacies = CONFIG.pharmacyIdRange.max - CONFIG.pharmacyIdRange.min + 1;

    // Process each pharmacy
    console.log(`Processing ${results.totalPharmacies} pharmacies...\n`);
    
    for (let pharmacyId = CONFIG.pharmacyIdRange.min; pharmacyId <= CONFIG.pharmacyIdRange.max; pharmacyId++) {
      console.log(`Processing pharmacy ${pharmacyId}...`);
      await processPharmacy(pharmacyId);
      results.processed += 1;

      // Progress update
      const progress = ((results.processed / results.totalPharmacies) * 100).toFixed(1);
      console.log(`Progress: ${progress}% (${results.processed}/${results.totalPharmacies})\n`);
    }

    // Generate report
    await generateReport();
    
    console.log('\n✓ Price update completed successfully!');
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main().catch(console.error);