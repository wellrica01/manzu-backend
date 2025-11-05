/**
 * Create Missing Ingredients Script
 * Generates SQL to insert missing MedicationIngredient records
 * 
 * Usage: node create-missing-ingredients.js missing-ingredients-{timestamp}.json
 */

const fs = require('fs');

const inputFile = process.argv[2] || 'missing-ingredients-1762304348476.json';

console.log(`Reading: ${inputFile}\n`);

const missingIngredients = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

console.log(`Found ${missingIngredients.length} missing ingredient combinations\n`);

// Generate SQL INSERT statements
const sqlStatements = [];

missingIngredients.forEach((ing, index) => {
  const strengthValue = ing.strengthValue !== null ? ing.strengthValue : 'NULL';
  const strengthUnit = ing.strengthUnit !== null ? `'${ing.strengthUnit}'` : 'NULL';
  const perUnitValue = ing.perUnitValue !== null ? ing.perUnitValue : 'NULL';
  const perUnitType = ing.perUnitType !== null ? `'${ing.perUnitType}'` : 'NULL';
  
  const sql = `INSERT INTO "MedicationIngredient" ("substanceId", "strengthValue", "strengthUnit", "perUnitValue", "perUnitType")
VALUES (${ing.substanceId}, ${strengthValue}, ${strengthUnit}, ${perUnitValue}, ${perUnitType});`;
  
  sqlStatements.push({
    index: index + 1,
    substance: ing.substanceName,
    sql: sql,
    affectedProducts: ing.affectedProductCount,
  });
});

// Write SQL file
const sqlFile = `create-missing-ingredients-${Date.now()}.sql`;
const sqlContent = sqlStatements.map(s => `-- ${s.index}. ${s.substance} (affects ${s.affectedProducts} products)\n${s.sql}`).join('\n\n');

fs.writeFileSync(sqlFile, sqlContent);

console.log('='.repeat(60));
console.log('SQL STATEMENTS GENERATED');
console.log('='.repeat(60));
console.log(`\nFile: ${sqlFile}`);
console.log(`Total statements: ${sqlStatements.length}\n`);

// Show preview
console.log('Preview (first 5):\n');
sqlStatements.slice(0, 5).forEach(s => {
  console.log(`${s.index}. ${s.substance} - affects ${s.affectedProducts} products`);
  console.log(`   ${s.sql.split('\n')[1]}`);
  console.log('');
});

if (sqlStatements.length > 5) {
  console.log(`... and ${sqlStatements.length - 5} more\n`);
}

console.log('='.repeat(60));
console.log('NEXT STEPS');
console.log('='.repeat(60));
console.log(`
1. Review the generated SQL file: ${sqlFile}

2. Run it against your database:
   psql -d your_database -f ${sqlFile}
   
   Or using Prisma Studio / your DB client

3. Re-run the dry-run to verify:
   node scripts/import-medications.js --dry-run

4. Import the medications:
   node scripts/import-medications.js
`);

// Also create a Prisma-compatible JS script
const prismaFile = `create-missing-ingredients-prisma-${Date.now()}.js`;
const prismaScript = `const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createMissingIngredients() {
  console.log('Creating ${missingIngredients.length} missing ingredients...');
  
  const ingredients = ${JSON.stringify(missingIngredients.map(ing => ({
    substanceId: ing.substanceId,
    strengthValue: ing.strengthValue,
    strengthUnit: ing.strengthUnit,
    perUnitValue: ing.perUnitValue,
    perUnitType: ing.perUnitType,
  })), null, 2)};
  
  const result = await prisma.medicationIngredient.createMany({
    data: ingredients,
    skipDuplicates: true,
  });
  
  console.log(\`✓ Created \${result.count} ingredients\`);
}

createMissingIngredients()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
`;

fs.writeFileSync(prismaFile, prismaScript);

console.log(`\nAlternatively, use Prisma to create them:`);
console.log(`   node ${prismaFile}\n`);