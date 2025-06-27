const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
 const medications = await prisma.medication.createMany({
  data: [
    {
      name: 'Paracetamol',
      genericName: 'Acetaminophen',
      category: 'Analgesic',
      description: 'Pain reliever and fever reducer',
      manufacturer: 'Generic Pharma',
      form: 'Tablet',
      dosage: '500mg',
      nafdacCode: 'A4-1234',
      prescriptionRequired: false,
      imageUrl: 'http://example.com/paracetamol.jpg',
      createdAt: new Date(),
    },
    {
      name: 'Amoxicillin',
      genericName: 'Amoxicillin',
      category: 'Antibiotic',
      description: 'Antibiotic for bacterial infections',
      manufacturer: 'Generic Pharma',
      form: 'Capsule',
      dosage: '250mg',
      nafdacCode: 'A4-5678',
      prescriptionRequired: true,
      imageUrl: 'http://example.com/amoxicillin.jpg',
      createdAt: new Date(),
    },
  ],
  skipDuplicates: true,
});


  await prisma.$executeRaw`
    INSERT INTO "Pharmacy" (name, location, address, lga, state, phone, "licenseNumber", status, "verifiedAt", "logoUrl", "isActive")
    VALUES
      ('HealthPlus', ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326), '123 Lagos St, Lagos', 'Ikeja', 'Lagos', '08012345678', 'PH123', 'pending', NULL, 'http://example.com/healthplus.jpg', true),
      ('MedCare', ST_SetSRID(ST_MakePoint(3.3892, 6.5344), 4326), '456 Ikeja Rd, Lagos', 'Ife', 'Lagos', '08087654321', 'PH456', 'verified', NOW(), 'http://example.com/medcare.jpg', true)
    ON CONFLICT ("licenseNumber") DO NOTHING;
  `;

  const pharmacyMedications = await prisma.pharmacyMedication.createMany({
    data: [
      { pharmacyId: 1, medicationId: 1, stock: 100, price: 500.0, receivedDate: new Date(), expiryDate: new Date('2026-05-17') },
      { pharmacyId: 1, medicationId: 2, stock: 50, price: 1000.0, receivedDate: new Date(), expiryDate: new Date('2026-05-17') },
      { pharmacyId: 2, medicationId: 1, stock: 80, price: 550.0, receivedDate: new Date(), expiryDate: new Date('2026-05-17') },
      { pharmacyId: 2, medicationId: 2, stock: 60, price: 950.0, receivedDate: new Date(), expiryDate: new Date('2026-05-17') },
    ],
    skipDuplicates: true,
  });

  const prescription = await prisma.prescription.create({
    data: {
      patientIdentifier: 'GUEST_123456',
      fileUrl: 'http://s3.example.com/prescription1.pdf',
      status: 'pending',
      verified: false,
      createdAt: new Date(),
    },
  });

  const order = await prisma.order.create({
    data: {
      patientIdentifier: 'GUEST_123456',
      pharmacyId: 1,
      prescriptionId: prescription.id,
      status: 'pending',
      fulfillmentMethod: 'pickup',
      address: '123 Lagos St, Lagos',
      email: 'order1@gmail.com',
      phone: '09031211109',
      totalPrice: 1500.0,
      trackingCode: 'TRK123',
      paymentReference: 'PAY123',
      paymentStatus: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      filledAt: null,
      cancelledAt: null,
      cancelReason: null,
    },
  });

  const orderItems = await prisma.orderItem.createMany({
    data: [
      { orderId: order.id, pharmacyMedicationPharmacyId: 1, pharmacyMedicationMedicationId: 1, quantity: 2, price: 500.0 },
      { orderId: order.id, pharmacyMedicationPharmacyId: 1, pharmacyMedicationMedicationId: 2, quantity: 1, price: 1000.0 },
    ],
  });

  const hashedPassword1 = await bcrypt.hash('manager123', 10);
  const hashedPassword2 = await bcrypt.hash('pharmacist123', 10);
  const users = await prisma.pharmacyUser.createMany({
    data: [
      {
        email: 'manager@healthplus.com',
        password: hashedPassword1,
        name: 'John Manager',
        role: 'manager',
        pharmacyId: 1,
        createdAt: new Date(),
        lastLogin: null,
      },
      {
        email: 'pharmacist@medcare.com',
        password: hashedPassword2,
        name: 'Jane Pharmacist',
        role: 'pharmacist',
        pharmacyId: 2,
        createdAt: new Date(),
        lastLogin: null,
      },
    ],
    skipDuplicates: true,
  });

  const hashedAdminPassword = await bcrypt.hash('@admin123', 10);
  const adminUsers = await prisma.adminUser.createMany({
    data: [
      {
        email: 'admin@xai.com',
        password: hashedAdminPassword,
        name: 'Admin User',
        role: 'admin',
        createdAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seed data created:', { medications, pharmacyMedications, prescription, order, orderItems, users, adminUsers });
}

main()
  .catch((e) => {
    console.error('Error seeding data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });