/**
 * Medication SQL Generator
 * Generates SQL files from nafdac_matched_cleaned_final_v7.json
 * 
 * Usage:
 *   node generate-medication-sql.js [--batch-size=500] [--start-from=0]
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

// Configuration
const CONFIG = {
  batchSize: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 500,
  startFrom: parseInt(process.argv.find(arg => arg.startsWith('--start-from='))?.split('=')[1]) || 0,
  jsonFile: 'nafdac_matched_cleaned_final_v7.json',
  outputDir: 'sql-batches',
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
  },
  sqlFiles: [],
};

/**
 * Escape SQL strings
 */
function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

/**
 * Load all manufacturers into memory for lookup
 */
async function loadManufacturers() {
  console.log('Loading manufacturers...');
  const manufacturers = await prisma.manufacturer.findMany();
  
  const map = new Map();
  manufacturers.forEach(m => {
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
  if (!marketingCategory) return true;
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
 * Prepare a single product for SQL generation
 */
function prepareProduct(product, manufacturerMap, ingredientMap) {
  const warnings = [];
  const errors = [];
  
  // Lookup manufacturer
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
  // nafdacCode is now optional, so don't fail if missing
  if (!product.dosageForm) {
    errors.push('Missing dosageForm');
  }
  
  return {
    nrn: product.nrn,
    brandName: product.brandName,
    brandDescription: product.composition || null,
    nafdacCode: product.nrn,
    form: product.dosageForm || null,
    packSizeExpression: product.packSize || null,
    prescriptionRequired: mapPrescriptionRequired(product.marketingCategory),
    nafdacStatus: mapNafdacStatus(product.status),
    manufacturerId: manufacturerId || null,
    routes: product.roas || [],
    ingredientIds,
    warnings,
    errors,
  };
}

/**
 * Generate SQL for a batch of products
 */
function generateBatchSql(products, manufacturerMap, ingredientMap, batchIndex) {
  const sqlStatements = [];
  const batchResults = {
    successful: 0,
    failed: 0,
    skipped: 0,
  };
  
  // Start transaction
  sqlStatements.push('BEGIN;');
  sqlStatements.push('');
  
  // Process each product
  for (const product of products) {
    // Skip if explicitly marked as skipped
    if (product.skipped) {
      batchResults.skipped++;
      results.skipped++;
      continue;
    }
    
    try {
      const prepared = prepareProduct(product, manufacturerMap, ingredientMap);
      
      // Log warnings
      if (prepared.warnings.length > 0) {
        results.warnings.push({
          nrn: product.nrn,
          brandName: product.brandName,
          warnings: prepared.warnings,
        });
        sqlStatements.push(`-- WARNING: ${product.nrn} - ${prepared.warnings.join(', ')}`);
      }
      
      // Check for errors
      if (prepared.errors.length > 0) {
        results.errors.push({
          nrn: product.nrn,
          brandName: product.brandName,
          errors: prepared.errors,
        });
        batchResults.failed++;
        results.failed++;
        sqlStatements.push(`-- ERROR: ${product.nrn} - ${prepared.errors.join(', ')}`);
        sqlStatements.push('');
        continue;
      }
      
      // Generate medication INSERT
      sqlStatements.push(`-- Product: ${prepared.brandName} (${prepared.nrn})`);
      sqlStatements.push(`DO $$`);
      sqlStatements.push(`DECLARE`);
      sqlStatements.push(`  v_medication_id INT;`);
      sqlStatements.push(`BEGIN`);
      
      // Insert medication
      sqlStatements.push(`  -- Insert medication`);
      sqlStatements.push(`  INSERT INTO "Medication" (`);
      sqlStatements.push(`    "brandName",`);
      sqlStatements.push(`    "brandDescription",`);
      sqlStatements.push(`    "nafdacCode",`);
      sqlStatements.push(`    "form",`);
      sqlStatements.push(`    "route",`);
      sqlStatements.push(`    "packSizeExpression",`);
      sqlStatements.push(`    "prescriptionRequired",`);
      sqlStatements.push(`    "nafdacStatus",`);
      sqlStatements.push(`    "manufacturerId",`);
      sqlStatements.push(`    "createdAt"`);
      sqlStatements.push(`  ) VALUES (`);
      sqlStatements.push(`    ${escapeSql(prepared.brandName)},`);
      sqlStatements.push(`    ${escapeSql(prepared.brandDescription)},`);
      sqlStatements.push(`    ${escapeSql(prepared.nafdacCode)},`);
      sqlStatements.push(`    ${escapeSql(prepared.form)},`);
      sqlStatements.push(`    NULL,`);
      sqlStatements.push(`    ${escapeSql(prepared.packSizeExpression)},`);
      sqlStatements.push(`    ${prepared.prescriptionRequired},`);
      sqlStatements.push(`    ${escapeSql(prepared.nafdacStatus)},`);
      sqlStatements.push(`    ${prepared.manufacturerId || 'NULL'},`);
      sqlStatements.push(`    NOW()`);
      sqlStatements.push(`  )`);
      sqlStatements.push(`  RETURNING id INTO v_medication_id;`);
      sqlStatements.push(``);
      
      // Insert routes if any
      if (prepared.routes.length > 0) {
        sqlStatements.push(`  -- Insert routes`);
        for (const route of prepared.routes) {
          sqlStatements.push(`  INSERT INTO "MedicationRoute" ("medication_id", "route", "created_at")`);
          sqlStatements.push(`  VALUES (v_medication_id, ${escapeSql(route)}, NOW())`);
          sqlStatements.push(`  ON CONFLICT ("medication_id", "route") DO NOTHING;`);
          sqlStatements.push(``);
          results.stats.routesCreated++;
        }
      }
      
      // Insert ingredient joins if any
      if (prepared.ingredientIds.length > 0) {
        sqlStatements.push(`  -- Insert ingredient joins`);
        for (const ingredientId of prepared.ingredientIds) {
          sqlStatements.push(`  INSERT INTO "Medication_MedicationIngredient" ("medicationId", "ingredientId")`);
          sqlStatements.push(`  VALUES (v_medication_id, ${ingredientId})`);
          sqlStatements.push(`  ON CONFLICT ("medicationId", "ingredientId") DO NOTHING;`);
          sqlStatements.push(``);
          results.stats.joinsCreated++;
        }
      }
      
      sqlStatements.push(`END $$;`);
      sqlStatements.push('');
      
      batchResults.successful++;
      results.successful++;
      results.stats.medicationsCreated++;
      
    } catch (error) {
      results.errors.push({
        nrn: product.nrn,
        brandName: product.brandName,
        errors: [`Unexpected error: ${error.message}`],
      });
      batchResults.failed++;
      results.failed++;
      sqlStatements.push(`-- ERROR: ${product.nrn} - ${error.message}`);
      sqlStatements.push('');
    }
  }
  
  // Commit transaction
  sqlStatements.push('COMMIT;');
  
  return {
    sql: sqlStatements.join('\n'),
    stats: batchResults,
  };
}

/**
 * Save SQL to file
 */
async function saveSqlFile(sql, batchIndex) {
  const filename = `batch_${String(batchIndex).padStart(4, '0')}.sql`;
  const filepath = path.join(CONFIG.outputDir, filename);
  await fs.writeFile(filepath, sql, 'utf-8');
  results.sqlFiles.push(filename);
  return filename;
}

/**
 * Generate master import script
 */
async function generateMasterScript() {
  const script = `#!/bin/bash
# Master Import Script
# Generated: ${new Date().toISOString()}
#
# Usage:
#   chmod +x run_import.sh
#   ./run_import.sh your_database_url
#
# Or manually run each file:
#   psql your_database_url -f ${CONFIG.outputDir}/batch_0001.sql

DATABASE_URL="$1"

if [ -z "$DATABASE_URL" ]; then
  echo "Error: Database URL required"
  echo "Usage: ./run_import.sh your_database_url"
  exit 1
fi

echo "Starting medication import..."
echo "Total batches: ${results.sqlFiles.length}"
echo ""

${results.sqlFiles.map((file, i) => `
echo "Processing ${file} (${i + 1}/${results.sqlFiles.length})..."
psql "$DATABASE_URL" -f ${CONFIG.outputDir}/${file}
if [ $? -ne 0 ]; then
  echo "Error in ${file}"
  exit 1
fi`).join('\n')}

echo ""
echo "✓ Import completed successfully!"
echo "Total medications: ${results.stats.medicationsCreated}"
echo "Total routes: ${results.stats.routesCreated}"
echo "Total joins: ${results.stats.joinsCreated}"
`;

  await fs.writeFile('run_import.sh', script, 'utf-8');
  await fs.chmod('run_import.sh', 0o755);
  console.log('✓ Created run_import.sh');
}

/**
 * Generate PowerShell import script
 */
async function generatePowerShellScript() {
  const script = `# PowerShell Import Script
# Generated: ${new Date().toISOString()}
#
# Usage:
#   .\\run_import.ps1 "your_database_url"

param(
    [Parameter(Mandatory=$true)]
    [string]$DatabaseUrl
)

Write-Host "Starting medication import..." -ForegroundColor Green
Write-Host "Total batches: ${results.sqlFiles.length}"
Write-Host ""

${results.sqlFiles.map((file, i) => `
Write-Host "Processing ${file} (${i + 1}/${results.sqlFiles.length})..." -ForegroundColor Yellow
psql "$DatabaseUrl" -f ${CONFIG.outputDir}/${file}
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error in ${file}" -ForegroundColor Red
    exit 1
}`).join('\n')}

Write-Host ""
Write-Host "✓ Import completed successfully!" -ForegroundColor Green
Write-Host "Total medications: ${results.stats.medicationsCreated}"
Write-Host "Total routes: ${results.stats.routesCreated}"
Write-Host "Total joins: ${results.stats.joinsCreated}"
`;

  await fs.writeFile('run_import.ps1', script, 'utf-8');
  console.log('✓ Created run_import.ps1');
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
    sqlFiles: results.sqlFiles,
    warnings: results.warnings,
    errors: results.errors,
  };
  
  const reportPath = `sql-generation-report-${Date.now()}.json`;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('SQL GENERATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Products:     ${results.totalProducts}`);
  console.log(`Processed:          ${results.processed}`);
  console.log(`✓ Successful:       ${results.successful}`);
  console.log(`✗ Failed:           ${results.failed}`);
  console.log(`⊘ Skipped:          ${results.skipped}`);
  console.log(`Success Rate:       ${report.summary.successRate}`);
  console.log('\nSQL Files Generated:');
  console.log(`  Total Batches:    ${results.sqlFiles.length}`);
  console.log(`  Medications:      ${results.stats.medicationsCreated}`);
  console.log(`  Routes:           ${results.stats.routesCreated}`);
  console.log(`  Joins:            ${results.stats.joinsCreated}`);
  console.log(`\n⚠  Warnings:         ${results.warnings.length}`);
  console.log(`✗ Errors:           ${results.errors.length}`);
  console.log('\n' + '='.repeat(60));
  console.log(`Report saved to: ${reportPath}`);
  console.log(`SQL files saved to: ${CONFIG.outputDir}/`);
  
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
  console.log('MEDICATION SQL GENERATOR');
  console.log('='.repeat(60));
  console.log(`Batch Size:  ${CONFIG.batchSize}`);
  console.log(`Start From:  ${CONFIG.startFrom}`);
  console.log(`JSON File:   ${CONFIG.jsonFile}`);
  console.log(`Output Dir:  ${CONFIG.outputDir}`);
  console.log('='.repeat(60) + '\n');
  
  try {
    // Create output directory
    await fs.mkdir(CONFIG.outputDir, { recursive: true });
    console.log(`✓ Created output directory: ${CONFIG.outputDir}\n`);
    
    // Load JSON data
    console.log('Loading JSON data...');
    const jsonPath = path.join(process.cwd(), CONFIG.jsonFile);
    const jsonContent = await fs.readFile(jsonPath, 'utf-8');
    const data = JSON.parse(jsonContent);
    
    results.totalProducts = data.products.length;
    console.log(`✓ Loaded ${results.totalProducts} products\n`);
    
    // Load reference data (only for lookups, not for direct DB operations)
    const manufacturerMap = await loadManufacturers();
    const ingredientMap = await loadIngredients();
    console.log('');
    
    await prisma.$disconnect();
    
    // Process in batches
    const products = data.products.slice(CONFIG.startFrom);
    const totalBatches = Math.ceil(products.length / CONFIG.batchSize);
    
    console.log(`Generating SQL for ${products.length} products in ${totalBatches} batches...\n`);
    
    for (let i = 0; i < products.length; i += CONFIG.batchSize) {
      const batch = products.slice(i, i + CONFIG.batchSize);
      const batchIndex = Math.floor(i / CONFIG.batchSize) + 1;
      
      console.log(`Generating batch ${batchIndex}/${totalBatches}...`);
      
      const { sql, stats } = generateBatchSql(batch, manufacturerMap, ingredientMap, batchIndex);
      const filename = await saveSqlFile(sql, batchIndex);
      
      results.processed += batch.length;
      
      console.log(`✓ Saved ${filename} (${stats.successful} medications, ${stats.failed} failed, ${stats.skipped} skipped)`);
      
      // Progress update
      const progress = ((results.processed / products.length) * 100).toFixed(1);
      console.log(`Progress: ${progress}% (${results.processed}/${products.length})\n`);
    }
    
    // Generate master scripts and report
    console.log('Generating import scripts...');
    await generateMasterScript();
    await generatePowerShellScript();
    
    await generateReport();
    
    console.log('\n✓ SQL generation completed successfully!');
    console.log(`\nTo import on Windows: .\\run_import.ps1 "your_database_url"`);
    console.log(`To import on Linux/Mac: ./run_import.sh "your_database_url"`);
    console.log(`Or manually: psql "your_database_url" -f ${CONFIG.outputDir}/batch_0001.sql`);
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);