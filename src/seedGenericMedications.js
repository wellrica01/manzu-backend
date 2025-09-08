import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  // Load medications JSON
  const medsData = JSON.parse(fs.readFileSync('./genericMedications.json', 'utf8'));

  for (const med of medsData) {
    // 1️⃣ Create GenericMedication
    const createdMed = await prisma.genericMedication.create({
      data: {
        name: med.name,
        inn: med.inn,
        atcCode: med.atcCode,
        description: med.description
      }
    });

    // 2️⃣ Find TherapeuticClass by name
    const therapeuticClass = await prisma.therapeuticClass.findFirst({
      where: { name: med.therapeuticClass }
    });

    if (therapeuticClass) {
      // 3️⃣ Link medication to therapeutic class
      await prisma.genericMedicationTherapeuticClass.create({
        data: {
          genericMedicationId: createdMed.id,
          therapeuticClassId: therapeuticClass.id
        }
      });
    } else {
      console.warn(`Therapeutic class not found for medication: ${med.name}`);
    }
  }

  console.log('GenericMedication seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
