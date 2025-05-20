-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('cart', 'pending', 'pending_prescription', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "PharmacyStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('admin', 'support');

-- CreateEnum
CREATE TYPE "PharmacyUserRole" AS ENUM ('manager', 'pharmacist');

-- CreateTable
CREATE TABLE "Medication" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "manufacturer" TEXT,
    "form" TEXT,
    "dosage" TEXT,
    "nafdacCode" TEXT NOT NULL,
    "prescriptionRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrl" TEXT,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pharmacy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "location" geometry(Point, 4326) NOT NULL,
    "address" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "status" "PharmacyStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Pharmacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyMedication" (
    "pharmacyId" INTEGER NOT NULL,
    "medicationId" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "receivedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),

    CONSTRAINT "PharmacyMedication_pkey" PRIMARY KEY ("pharmacyId","medicationId")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" SERIAL NOT NULL,
    "patientIdentifier" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'pending',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "patientIdentifier" TEXT NOT NULL,
    "pharmacyId" INTEGER NOT NULL,
    "prescriptionId" INTEGER,
    "status" "OrderStatus" NOT NULL DEFAULT 'cart',
    "deliveryMethod" TEXT DEFAULT 'unspecified',
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trackingCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "paymentReference" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "pharmacyMedicationPharmacyId" INTEGER NOT NULL,
    "pharmacyMedicationMedicationId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyUser" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PharmacyUserRole" NOT NULL DEFAULT 'manager',
    "pharmacyId" INTEGER NOT NULL,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacyUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Medication_nafdacCode_key" ON "Medication"("nafdacCode");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacy_licenseNumber_key" ON "Pharmacy"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingCode_key" ON "Order"("trackingCode");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentReference_key" ON "Order"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_pharmacyMedicationPharmacyId_pharmacyMedi_key" ON "OrderItem"("orderId", "pharmacyMedicationPharmacyId", "pharmacyMedicationMedicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyUser_email_key" ON "PharmacyUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- AddForeignKey
ALTER TABLE "PharmacyMedication" ADD CONSTRAINT "PharmacyMedication_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyMedication" ADD CONSTRAINT "PharmacyMedication_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pharmacyMedicationPharmacyId_pharmacyMedicationM_fkey" FOREIGN KEY ("pharmacyMedicationPharmacyId", "pharmacyMedicationMedicationId") REFERENCES "PharmacyMedication"("pharmacyId", "medicationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyUser" ADD CONSTRAINT "PharmacyUser_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
