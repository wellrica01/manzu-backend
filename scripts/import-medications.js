/**
 * Medication Import Script
 * Imports medications from nafdac_matched_cleaned_final_v7.json
 * 
 * Usage:
 *   node import-medications.js [--dry-run] [--batch-size=500] [--start-from=0]
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

// Configuration
const CONFIG = {
  dryRun: process.argv.includes('--dry-run'),
  batchSize: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 150,
  startFrom: parseInt(process.argv.find(arg => arg.startsWith('--start-from='))?.split('=')[1]) || 0,
  jsonFile: 'nafdac_matched_cleaned_final_v7.json',
};

// Results tracking
const results = {
  totalProducts: 0,
  processed: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  errors: [],
  warnings: [],
  stats: {
    medicationsCreated: 0,
    routesCreated: 0,
    joinsCreated: 0,
  }
};

/**
 * Load all manufacturers into memory for lookup
 */
async function loadManufacturers() {
  console.log('Loading manufacturers...');
  const manufacturers = await prisma.manufacturer.findMany();
  
  const map = new Map();
  manufacturers.forEach(m => {
    // Use exact name as stored in database
    map.set(m.name, m.id);
  });
  
  console.log(`✓ Loaded ${manufacturers.length} manufacturers`);
  return map;
}

/**
 * Load all medication ingredients into memory for lookup
 */
async function loadIngredients() {
  console.log('Loading medication ingredients...');
  const ingredients = await prisma.medicationIngredient.findMany({
    select: {
      id: true,
      substanceId: true,
      strengthValue: true,
      strengthUnit: true,
      perUnitValue: true,
      perUnitType: true,
    }
  });
  
  const map = new Map();
  ingredients.forEach(ing => {
    const key = makeIngredientKey(
      ing.substanceId,
      ing.strengthValue,
      ing.strengthUnit,
      ing.perUnitValue,
      ing.perUnitType
    );
    map.set(key, ing.id);
  });
  
  console.log(`✓ Loaded ${ingredients.length} medication ingredients`);
  return map;
}

/**
 * Create a composite key for ingredient lookup
 */
function makeIngredientKey(substanceId, strengthValue, strengthUnit, perUnitValue, perUnitType) {
  return `${substanceId}-${strengthValue || 'NULL'}-${strengthUnit || 'NULL'}-${perUnitValue || 'NULL'}-${perUnitType || 'NULL'}`;
}

/**
 * Map marketing category to prescription requirement
 */
function mapPrescriptionRequired(marketingCategory) {
  if (!marketingCategory) return true; // Default to prescription required
  return marketingCategory.includes('Prescription-only Medicine');
}

/**
 * Map status to NAFDAC status enum
 */
function mapNafdacStatus(status) {
  if (!status) return 'PENDING';
  if (status.toLowerCase() === 'active') return 'VALID';
  if (status.toLowerCase() === 'expired') return 'EXPIRED';
  return 'PENDING';
}

/**
 * Prepare a single product for insertion
 */
function prepareProduct(product, manufacturerMap, ingredientMap) {
  const warnings = [];
  const errors = [];
  
  // Lookup manufacturer using exact name from JSON
  // Use manufacturerName (not _originalManufacturerName) as it matches the database
  const manufacturerName = product.manufacturerName;
  const manufacturerId = manufacturerName ? manufacturerMap.get(manufacturerName) : null;
  
  if (!manufacturerId && manufacturerName) {
    warnings.push(`Manufacturer not found: "${manufacturerName}"`);
  }
  
  // Lookup ingredients
  const ingredientIds = [];
  const missingIngredients = [];
  
  for (const ing of product.matchedIngredients || []) {
    const key = makeIngredientKey(
      ing.match.substanceId,
      ing.strength.strengthValue,
      ing.strength.strengthUnit,
      ing.strength.perUnitValue,
      ing.strength.perUnitType
    );
    
    const ingredientId = ingredientMap.get(key);
    
    if (ingredientId) {
      ingredientIds.push(ingredientId);
    } else {
      missingIngredients.push({
        substance: ing.match.substanceName,
        key: key
      });
    }
  }
  
  if (missingIngredients.length > 0) {
    errors.push(`Missing ingredients: ${missingIngredients.map(m => `${m.substance} (${m.key})`).join(', ')}`);
  }
  
  // Validate required fields
  if (!product.brandName) {
    errors.push('Missing brandName');
  }
  if (!product.nrn) {
    errors.push('Missing nafdacCode (nrn)');
  }
  if (!product.dosageForm) {
    errors.push('Missing dosageForm');
  }
  
  // Prepare medication data
  const medication = {
    brandName: product.brandName,
    brandDescription: product.composition || null,
    nafdacCode: product.nrn,
    form: product.dosageForm || null,
    route: null, // As per strategy, leave NULL
    packSizeExpression: product.packSize || null,
    prescriptionRequired: mapPrescriptionRequired(product.marketingCategory),
    nafdacStatus: mapNafdacStatus(product.status),
    manufacturerId: manufacturerId || null,
    createdAt: new Date(),
  };
  
  // Prepare routes
  const routes = (product.roas || []).map(route => ({
    route: route,
  }));
  
  return {
    medication,
    routes,
    ingredientIds,
    warnings,
    errors,
  };
}

/**
 * Process a batch of products
 */
async function processBatch(products, manufacturerMap, ingredientMap, batchIndex) {
  const batchResults = {
    medicationsToCreate: [],
    productsData: [], // Track product-to-index mapping
  };

  // Step 1: Prepare all products in the batch
  for (let i = 0; i < products.length; i++) {
    const product = products[i];

    if (product.skipped) {
      results.skipped++;
      continue;
    }

    try {
      const prepared = prepareProduct(product, manufacturerMap, ingredientMap);

      if (prepared.warnings.length > 0) {
        results.warnings.push({
          nrn: product.nrn,
          brandName: product.brandName,
          warnings: prepared.warnings,
        });
      }

      if (prepared.errors.length > 0) {
        results.errors.push({
          nrn: product.nrn,
          brandName: product.brandName,
          errors: prepared.errors,
        });
        results.failed++;
        continue;
      }

      batchResults.medicationsToCreate.push(prepared.medication);
      batchResults.productsData.push({
        nrn: product.nrn,
        routes: prepared.routes,
        ingredientIds: prepared.ingredientIds,
      });

    } catch (error) {
      results.errors.push({
        nrn: product.nrn,
        brandName: product.brandName,
        errors: [`Unexpected error: ${error.message}`],
      });
      results.failed++;
    }
  }

  if (CONFIG.dryRun) {
    console.log(`[DRY RUN] Would create ${batchResults.medicationsToCreate.length} medications`);
    results.successful += batchResults.medicationsToCreate.length;
    return;
  }

  if (batchResults.medicationsToCreate.length === 0) {
    console.log(`Batch ${batchIndex}: No medications to create`);
    return;
  }

  try {
    // Step 2: Insert medications in batch
    await prisma.medication.createMany({
      data: batchResults.medicationsToCreate,
      skipDuplicates: true,
    });

    // Step 3: Fetch IDs of inserted medications
    const insertedMedications = await prisma.medication.findMany({
      where: {
        nafdacCode: {
          in: batchResults.medicationsToCreate.map(m => m.nafdacCode),
        },
      },
      select: {
        id: true,
        nafdacCode: true,
      },
    });

    // Step 4: Create a lookup map for med ID
    const medIdMap = new Map();
    insertedMedications.forEach(med => medIdMap.set(med.nafdacCode, med.id));

    // Step 5: Insert routes
    const routesToInsert = [];
    batchResults.productsData.forEach(productData => {
      const medId = medIdMap.get(productData.nrn);
      if (!medId) return; // Skip if not inserted
      productData.routes.forEach(route => {
        routesToInsert.push({
          medication_id: medId,
          route: route.route,
        });
      });
    });

    if (routesToInsert.length > 0) {
      await prisma.medicationRoute.createMany({
        data: routesToInsert,
        skipDuplicates: true,
      });
      results.stats.routesCreated += routesToInsert.length;
    }

    // Step 6: Insert medication-ingredient joins
    const joinsToInsert = [];
    batchResults.productsData.forEach(productData => {
      const medId = medIdMap.get(productData.nrn);
      if (!medId) return;
      productData.ingredientIds.forEach(ingredientId => {
        joinsToInsert.push({
          medicationId: medId,
          ingredientId: ingredientId,
        });
      });
    });

    if (joinsToInsert.length > 0) {
      await prisma.medication_MedicationIngredient.createMany({
        data: joinsToInsert,
        skipDuplicates: true,
      });
      results.stats.joinsCreated += joinsToInsert.length;
    }

    results.successful += batchResults.medicationsToCreate.length;
    console.log(`✓ Batch ${batchIndex}: Created ${batchResults.medicationsToCreate.length} medications`);

  } catch (error) {
    console.error(`✗ Batch ${batchIndex} failed:`, error.message);
    results.failed += batchResults.medicationsToCreate.length;

    for (const productData of batchResults.productsData) {
      results.errors.push({
        nrn: productData.nrn,
        errors: [`Batch insertion failed: ${error.message}`],
      });
    }
  }
}



const MAX_RETRIES = 3; // Retry failed batch up to 3 times
const RETRY_DELAY_MS = 5000; // Wait 5 seconds before retrying

async function processBatchWithRetry(batch, manufacturerMap, ingredientMap, batchIndex) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await processBatch(batch, manufacturerMap, ingredientMap, batchIndex);
      return; // Batch succeeded, exit retry loop
    } catch (error) {
      console.error(`Batch ${batchIndex} attempt ${attempt} failed: ${error.message}`);

      if (attempt < MAX_RETRIES) {
        console.log(`Retrying batch ${batchIndex} in ${RETRY_DELAY_MS / 1000} seconds...`);
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS));

        // Reconnect Prisma client to handle dropped connections
        await prisma.$disconnect();
        prisma = new PrismaClient();
      } else {
        console.error(`Batch ${batchIndex} failed after ${MAX_RETRIES} attempts.`);
        results.failed += batch.length;

        // Log all products in failed batch
        for (const product of batch) {
          results.errors.push({
            nrn: product.nrn,
            brandName: product.brandName,
            errors: [`Batch failed after ${MAX_RETRIES} attempts: ${error.message}`],
          });
        }
      }
    }
  }
}


/**
 * Generate and save import report
 */
async function generateReport() {
  const report = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    summary: {
      totalProducts: results.totalProducts,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      skipped: results.skipped,
      successRate: ((results.successful / results.totalProducts) * 100).toFixed(2) + '%',
    },
    stats: results.stats,
    warnings: results.warnings,
    errors: results.errors,
  };
  
  const reportPath = `import-report-${Date.now()}.json`;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Products:     ${results.totalProducts}`);
  console.log(`Processed:          ${results.processed}`);
  console.log(`✓ Successful:       ${results.successful}`);
  console.log(`✗ Failed:           ${results.failed}`);
  console.log(`⊘ Skipped:          ${results.skipped}`);
  console.log(`Success Rate:       ${report.summary.successRate}`);
  console.log('\nDatabase Inserts:');
  console.log(`  Medications:      ${results.stats.medicationsCreated}`);
  console.log(`  Routes:           ${results.stats.routesCreated}`);
  console.log(`  Joins:            ${results.stats.joinsCreated}`);
  console.log(`\n⚠  Warnings:         ${results.warnings.length}`);
  console.log(`✗ Errors:           ${results.errors.length}`);
  console.log('\n' + '='.repeat(60));
  console.log(`Report saved to: ${reportPath}`);
  
  if (results.errors.length > 0) {
    console.log('\nFirst 5 errors:');
    results.errors.slice(0, 5).forEach((err, i) => {
      console.log(`${i + 1}. ${err.nrn} - ${err.brandName || 'N/A'}`);
      err.errors.forEach(e => console.log(`   • ${e}`));
    });
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('MEDICATION IMPORT SCRIPT');
  console.log('='.repeat(60));
  console.log(`Mode:        ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch Size:  ${CONFIG.batchSize}`);
  console.log(`Start From:  ${CONFIG.startFrom}`);
  console.log(`JSON File:   ${CONFIG.jsonFile}`);
  console.log('='.repeat(60) + '\n');
  
  try {
    // Load JSON data
    console.log('Loading JSON data...');
    const jsonPath = path.join(process.cwd(), CONFIG.jsonFile);
    const jsonContent = await fs.readFile(jsonPath, 'utf-8');
    const data = JSON.parse(jsonContent);
    
    results.totalProducts = data.products.length;
    console.log(`✓ Loaded ${results.totalProducts} products\n`);
    
    // Load reference data
    const manufacturerMap = await loadManufacturers();
    const ingredientMap = await loadIngredients();
    console.log('');
    
    // Process in batches
    const products = data.products.slice(CONFIG.startFrom);
    const totalBatches = Math.ceil(products.length / CONFIG.batchSize);
    
    console.log(`Processing ${products.length} products in ${totalBatches} batches...\n`);
    
    for (let i = 0; i < products.length; i += CONFIG.batchSize) {
    const batch = products.slice(i, i + CONFIG.batchSize);
    const batchIndex = Math.floor(i / CONFIG.batchSize) + 1;

    console.log(`Processing batch ${batchIndex}/${totalBatches}...`);
    await processBatchWithRetry(batch, manufacturerMap, ingredientMap, batchIndex);

    results.processed += batch.length;

    // Progress update
    const progress = ((results.processed / products.length) * 100).toFixed(1);
    console.log(`Progress: ${progress}% (${results.processed}/${products.length})\n`);
    }

    // Generate report
    await generateReport();
    
    console.log('\n✓ Import completed successfully!');
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main().catch(console.error);