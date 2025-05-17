const { PrismaClient } = require('@prisma/client');
     const bcrypt = require('bcrypt');
     const prisma = new PrismaClient();
     async function main() {
       const medications = await prisma.medication.createMany({
         data: [
           { name: 'Paracetamol', genericName: 'Acetaminophen', nafdacCode: 'A4-1234', imageUrl: 'http://example.com/paracetamol.jpg' },
           { name: 'Amoxicillin', genericName: 'Amoxicillin', nafdacCode: 'A4-5678', imageUrl: 'http://example.com/amoxicillin.jpg' },
         ],
         skipDuplicates: true,
       });
       await prisma.$executeRaw`
         INSERT INTO "Pharmacy" (name, location, address, lga, state, phone, "licenseNumber")
         VALUES
           ('HealthPlus', ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326), '123 Lagos St, Lagos', 'Ikeja', 'Lagos', '08012345678', 'PH123'),
           ('MedCare', ST_SetSRID(ST_MakePoint(3.3892, 6.5344), 4326), '456 Ikeja Rd, Lagos', 'Ife', 'Lagos', '08087654321', 'PH456')
         ON CONFLICT ("licenseNumber") DO NOTHING;
       `;
       const pharmacyMedications = await prisma.pharmacyMedication.createMany({
         data: [
           { pharmacyId: 1, medicationId: 1, stock: 100, price: 500.0 },
           { pharmacyId: 1, medicationId: 2, stock: 50, price: 1000.0 },
           { pharmacyId: 2, medicationId: 1, stock: 80, price: 550.0 },
           { pharmacyId: 2, medicationId: 2, stock: 60, price: 950.0 },
         ],
         skipDuplicates: true,
       });
       const prescription = await prisma.prescription.create({
         data: {
           patientIdentifier: 'GUEST_123456',
           fileUrl: 'http://s3.example.com/prescription1.pdf',
           status: 'pending',
           verified: false,
         },
       });
       const order = await prisma.order.create({
         data: {
           patientIdentifier: 'GUEST_123456',
           pharmacyId: 1,
           prescriptionId: prescription.id,
           status: 'pending',
           deliveryMethod: 'pickup',
           address: '123 Lagos St, Lagos',
           totalPrice: 1500.0,
           trackingCode: 'TRK123',
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
           { email: 'manager@healthplus.com', password: hashedPassword1, name: 'John Manager', role: 'manager', pharmacyId: 1 },
           { email: 'pharmacist@medcare.com', password: hashedPassword2, name: 'Jane Pharmacist', role: 'pharmacist', pharmacyId: 2 },
         ],
         skipDuplicates: true,
       });
       console.log('Seed data created:', { medications, pharmacyMedications, prescription, order, orderItems, users });
     }
     main()
       .catch((e) => {
         console.error('Error seeding data:', e);
         process.exit(1);
       })
       .finally(async () => {
         await prisma.$disconnect();
       });