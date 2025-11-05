/**
 * Analyze Import Report
 * Provides detailed analysis of import issues
 * 
 * Usage: node analyze-report.js import-report-{timestamp}.json
 */

const fs = require('fs');

const reportFile = process.argv[2] || 'import-report-1762304037918.json';

console.log(`Analyzing: ${reportFile}\n`);

const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));

console.log('='.repeat(60));
console.log('DETAILED ANALYSIS');
console.log('='.repeat(60));

// 1. Analyze Errors
console.log('\n📊 ERROR ANALYSIS');
console.log('-'.repeat(60));

const missingIngredients = new Map();
const otherErrors = [];

report.errors.forEach(err => {
  err.errors.forEach(errMsg => {
    if (errMsg.startsWith('Missing ingredients:')) {
      // Extract ingredient info
      const ingredients = errMsg.replace('Missing ingredients:', '').split(',');
      ingredients.forEach(ing => {
        const match = ing.match(/(.+?)\s+\((.+?)\)/);
        if (match) {
          const [, substanceName, key] = match;
          const count = missingIngredients.get(key) || { name: substanceName.trim(), count: 0, products: [] };
          count.count++;
          count.products.push(err.nrn);
          missingIngredients.set(key, count);
        }
      });
    } else {
      otherErrors.push({ nrn: err.nrn, error: errMsg });
    }
  });
});

console.log(`\nTotal unique missing ingredient combinations: ${missingIngredients.size}`);
console.log(`\nTop 10 most common missing ingredients:\n`);

const sortedMissing = Array.from(missingIngredients.entries())
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 10);

sortedMissing.forEach(([key, data], i) => {
  console.log(`${i + 1}. ${data.name}`);
  console.log(`   Key: ${key}`);
  console.log(`   Affected products: ${data.count}`);
  console.log(`   Sample NRNs: ${data.products.slice(0, 3).join(', ')}${data.products.length > 3 ? '...' : ''}`);
  console.log('');
});

if (otherErrors.length > 0) {
  console.log(`\nOther errors: ${otherErrors.length}`);
  otherErrors.slice(0, 5).forEach(err => {
    console.log(`  • ${err.nrn}: ${err.error}`);
  });
}

// 2. Analyze Warnings
console.log('\n📊 WARNING ANALYSIS');
console.log('-'.repeat(60));

const warningTypes = new Map();
const manufacturerIssues = new Map();

report.warnings.forEach(warn => {
  warn.warnings.forEach(warnMsg => {
    if (warnMsg.startsWith('Manufacturer not found:')) {
      const mfg = warnMsg.replace('Manufacturer not found:', '').trim();
      const count = manufacturerIssues.get(mfg) || { count: 0, products: [] };
      count.count++;
      count.products.push(warn.nrn);
      manufacturerIssues.set(mfg, count);
    } else {
      const type = warnMsg.split(':')[0];
      warningTypes.set(type, (warningTypes.get(type) || 0) + 1);
    }
  });
});

if (manufacturerIssues.size > 0) {
  console.log(`\nTotal products with manufacturer issues: ${report.warnings.length}`);
  console.log(`Unique missing manufacturers: ${manufacturerIssues.size}\n`);
  console.log('Top 10 missing manufacturers:\n');
  
  const sortedMfgs = Array.from(manufacturerIssues.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  
  sortedMfgs.forEach(([mfg, data], i) => {
    console.log(`${i + 1}. ${mfg}`);
    console.log(`   Affected products: ${data.count}`);
    console.log('');
  });
}

if (warningTypes.size > 0) {
  console.log('\nOther warning types:');
  warningTypes.forEach((count, type) => {
    console.log(`  • ${type}: ${count}`);
  });
}

// 3. Summary & Recommendations
console.log('\n='.repeat(60));
console.log('RECOMMENDATIONS');
console.log('='.repeat(60));

if (missingIngredients.size > 0) {
  console.log('\n1. MISSING INGREDIENTS');
  console.log('   You need to create these ingredient combinations:');
  console.log(`   Total: ${missingIngredients.size} combinations`);
  console.log('   ');
  console.log('   Options:');
  console.log('   a) Create them manually in the database');
  console.log('   b) Run a script to auto-create missing ingredients');
  console.log('   c) Import without these 117 products for now');
}

if (manufacturerIssues.size > 0) {
  console.log('\n2. MANUFACTURER WARNINGS');
  console.log(`   ${report.warnings.length} products reference manufacturers that weren't found`);
  console.log('   These products WILL BE IMPORTED but without manufacturerId');
  console.log('   ');
  console.log('   This is OK if:');
  console.log('   - The manufacturer names don\'t match exactly (typos, formatting)');
  console.log('   - These are minor/unknown manufacturers');
  console.log('   ');
  console.log('   To fix: Update manufacturer names in your database to match');
}

console.log('\n3. NEXT STEPS');
console.log('   ');
console.log('   Option A - Import successful products now:');
console.log('   $ node scripts/import-medications.js');
console.log('   This will import 6,457 products (98.22%)');
console.log('   ');
console.log('   Option B - Fix missing ingredients first:');
console.log('   Create missing ingredients, then run full import');
console.log('   ');
console.log('   Option C - Auto-create missing ingredients:');
console.log('   Modify script to create ingredients on-the-fly');

console.log('\n' + '='.repeat(60));

// 4. Export missing ingredients for easy creation
const missingIngredientsData = Array.from(missingIngredients.entries()).map(([key, data]) => {
  const [substanceId, strengthValue, strengthUnit, perUnitValue, perUnitType] = key.split('-');
  return {
    substanceName: data.name,
    substanceId: parseInt(substanceId),
    strengthValue: strengthValue === 'NULL' ? null : parseFloat(strengthValue),
    strengthUnit: strengthUnit === 'NULL' ? null : strengthUnit,
    perUnitValue: perUnitValue === 'NULL' ? null : parseFloat(perUnitValue),
    perUnitType: perUnitType === 'NULL' ? null : perUnitType,
    affectedProductCount: data.count,
    sampleProducts: data.products.slice(0, 5),
  };
});

const outputFile = `missing-ingredients-${Date.now()}.json`;
fs.writeFileSync(outputFile, JSON.stringify(missingIngredientsData, null, 2));
console.log(`\n💾 Missing ingredients exported to: ${outputFile}`);
console.log('   Use this to create the missing MedicationIngredient records\n');