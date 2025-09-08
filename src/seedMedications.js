import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const medsData = JSON.parse(fs.readFileSync('./medications.json', 'utf8'));
  const componentsData = JSON.parse(fs.readFileSync('./drugComponents.json', 'utf8'));

  // Map generic names -> IDs
  const generics = await prisma.genericMedication.findMany();
  const genericMap = Object.fromEntries(generics.map(g => [g.name, g.id]));

  // Map brand names -> medication IDs
  const medicationMap = {};

  // 1️⃣ Insert Medications
  for (const m of medsData) {
    const genericId = genericMap[m.genericName];
    if (!genericId) {
      console.warn(`Generic medication not found: ${m.genericName}`);
      continue;
    }

    const createdMed = await prisma.medication.create({
      data: {
        brandName: m.brandName,
        genericMedicationId: genericId,
        form: m.form,
        strengthValue: m.strengthValue,
        strengthUnit: m.strengthUnit,
        route: m.route,
        isCombination: m.isCombination || false
      }
    });

    medicationMap[m.brandName] = createdMed.id;
  }

  // 2️⃣ Insert DrugComponents for combination drugs
  for (const c of componentsData) {
    const medicationId = medicationMap[c.medicationBrand];
    const genericId = genericMap[c.genericName];

    if (!medicationId || !genericId) {
      console.warn(`Cannot create component: ${c.medicationBrand} / ${c.genericName}`);
      continue;
    }

    await prisma.drugComponent.create({
      data: {
        medicationId,
        genericMedicationId: genericId,
        strength: c.strength,
        unit: c.unit
      }
    });
  }

  console.log('Medications and DrugComponents seeding complete!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
