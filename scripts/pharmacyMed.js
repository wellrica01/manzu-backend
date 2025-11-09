/**
 * Medication Availability Assignment Script
 * Assigns 100 random medications to each pharmacy (IDs 1-9) if not already assigned.
 * Medications are selected from IDs 1-6575.
 * 
 * Usage:
 *   node add-medication-availability.js [--dry-run] [--batch-size=100]
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

// Configuration
const CONFIG = {
  dryRun: process.argv.includes('--dry-run'),
  batchSize: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 100,
  medIdRange: { min: 1, max: 6575 },
  pharmacyIdRange: { min: 1, max: 9 },
};

// Results tracking
const results = {
  totalPharmacies: 0,
  processed: 0,
  successful: 0,
  failed: 0,
  assignmentsCreated: 0,
  errors: [],
  warnings: [],
};

/**
 * Generate a random integer between min and max (inclusive)
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Shuffle an array (Fisher-Yates shuffle)
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Process assignments for a single pharmacy
 */
async function processPharmacy(pharmacyId, allMedIds) {
  const pharmacyResults = {
    assignmentsToCreate: [],
  };

  try {
    // Get existing medication IDs for this pharmacy
    const existing = await prisma.medicationAvailability.findMany({
      where: { pharmacyId },
      select: { medicationId: true },
    });
    const existingIds = new Set(existing.map(e => e.medicationId));

    // Filter available meds
    const availableMeds = allMedIds.filter(id => !existingIds.has(id));

    if (availableMeds.length < 100) {
      results.warnings.push(`Pharmacy ${pharmacyId}: Only ${availableMeds.length} available meds (less than 100)`);
    }

    // Shuffle and select up to 100
    const selectedMeds = shuffleArray(availableMeds).slice(0, 100);

    // Prepare data
    for (const medId of selectedMeds) {
      pharmacyResults.assignmentsToCreate.push({
        medicationId: medId,
        pharmacyId,
        stock: getRandomInt(10, 200), // Random stock 10-200
        price: getRandomInt(500, 5000) / 100, // Random price 5.00 - 50.00
        receivedDate: new Date(),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        batchNumber: `BATCH-${getRandomInt(100000, 999999)}`,
      });
    }

    if (CONFIG.dryRun) {
      console.log(`[DRY RUN] Would create ${pharmacyResults.assignmentsToCreate.length} assignments for pharmacy ${pharmacyId}`);
      results.successful += 1;
      results.assignmentsCreated += pharmacyResults.assignmentsToCreate.length;
      return;
    }

    if (pharmacyResults.assignmentsToCreate.length === 0) {
      console.log(`Pharmacy ${pharmacyId}: No assignments to create`);
      results.successful += 1;
      return;
    }

    // Insert in batches if needed
    for (let i = 0; i < pharmacyResults.assignmentsToCreate.length; i += CONFIG.batchSize) {
      const batch = pharmacyResults.assignmentsToCreate.slice(i, i + CONFIG.batchSize);
      await prisma.medicationAvailability.createMany({
        data: batch,
        skipDuplicates: true,
      });
    }

    results.assignmentsCreated += pharmacyResults.assignmentsToCreate.length;
    results.successful += 1;
    console.log(`✓ Pharmacy ${pharmacyId}: Created ${pharmacyResults.assignmentsToCreate.length} assignments`);

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
      assignmentsCreated: results.assignmentsCreated,
      successRate: ((results.successful / results.totalPharmacies) * 100).toFixed(2) + '%',
    },
    warnings: results.warnings,
    errors: results.errors,
  };
  
  const reportPath = `assignment-report-${Date.now()}.json`;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('ASSIGNMENT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Pharmacies:   ${results.totalPharmacies}`);
  console.log(`Processed:          ${results.processed}`);
  console.log(`✓ Successful:       ${results.successful}`);
  console.log(`✗ Failed:           ${results.failed}`);
  console.log(`Assignments:        ${results.assignmentsCreated}`);
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
  console.log('MEDICATION AVAILABILITY ASSIGNMENT SCRIPT');
  console.log('='.repeat(60));
  console.log(`Mode:        ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch Size:  ${CONFIG.batchSize}`);
  console.log(`Med Range:   ${CONFIG.medIdRange.min}-${CONFIG.medIdRange.max}`);
  console.log(`Pharm Range: ${CONFIG.pharmacyIdRange.min}-${CONFIG.pharmacyIdRange.max}`);
  console.log('='.repeat(60) + '\n');
  
  try {
    // Generate all possible med IDs (assuming they exist)
    const allMedIds = [];
    for (let i = CONFIG.medIdRange.min; i <= CONFIG.medIdRange.max; i++) {
      allMedIds.push(i);
    }
    console.log(`✓ Generated ${allMedIds.length} medication IDs\n`);

    // Calculate total pharmacies
    results.totalPharmacies = CONFIG.pharmacyIdRange.max - CONFIG.pharmacyIdRange.min + 1;

    // Process each pharmacy
    console.log(`Processing ${results.totalPharmacies} pharmacies...\n`);
    
    for (let pharmacyId = CONFIG.pharmacyIdRange.min; pharmacyId <= CONFIG.pharmacyIdRange.max; pharmacyId++) {
      console.log(`Processing pharmacy ${pharmacyId}...`);
      await processPharmacy(pharmacyId, allMedIds);
      results.processed += 1;

      // Progress update
      const progress = ((results.processed / results.totalPharmacies) * 100).toFixed(1);
      console.log(`Progress: ${progress}% (${results.processed}/${results.totalPharmacies})\n`);
    }

    // Generate report
    await generateReport();
    
    console.log('\n✓ Assignment completed successfully!');
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main().catch(console.error);