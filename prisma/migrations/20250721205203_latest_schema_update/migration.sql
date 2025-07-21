-- CreateEnum
CREATE TYPE "DosageForm" AS ENUM ('TABLET', 'CAPSULE', 'CAPLET', 'SYRUP', 'INJECTION', 'CREAM', 'OINTMENT', 'GEL', 'SUSPENSION', 'POWDER', 'SUPPOSITORY', 'EYE_DROP', 'EAR_DROP', 'DROPS', 'NASAL_SPRAY', 'INHALER', 'PATCH', 'LOZENGE', 'EFFERVESCENT');

-- CreateEnum
CREATE TYPE "Route" AS ENUM ('ORAL', 'INTRAVENOUS', 'INTRAMUSCULAR', 'SUBCUTANEOUS', 'TOPICAL', 'INHALATION', 'RECTAL', 'VAGINAL', 'OPHTHALMIC', 'OTIC', 'NASAL', 'SUBLINGUAL', 'BUCCAL', 'TRANSDERMAL');

-- CreateEnum
CREATE TYPE "PharmacyStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('UNSPECIFIED', 'PICKUP', 'COURIER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PharmacyUserRole" AS ENUM ('MANAGER', 'PHARMACIST', 'ADMIN', 'STAFF', 'OWNER', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY', 'MARKETING', 'DATA_SHARING', 'REGULATORY');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'SUPER_ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "StrengthUnit" AS ENUM ('MG', 'ML', 'G', 'MCG', 'IU', 'NG', 'MMOL', 'PERCENT');

-- CreateEnum
CREATE TYPE "PackSizeUnit" AS ENUM ('TABLETS', 'CAPSULES', 'ML', 'VIALS', 'AMPOULES', 'SACHETS', 'PATCHES', 'BOTTLES', 'TUBES', 'BLISTERS');

-- CreateEnum
CREATE TYPE "RestrictedTo" AS ENUM ('GENERAL', 'HOSPITAL_ONLY', 'SPECIALTY_PHARMACY', 'CONTROLLED_SUBSTANCE');

-- CreateEnum
CREATE TYPE "PharmacyType" AS ENUM ('COMMUNITY', 'HOSPITAL', 'SPECIALTY', 'PMV');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAY_NOW', 'PAY_LATER');

-- CreateEnum
CREATE TYPE "RegulatoryClass" AS ENUM ('OTC', 'PRESCRIPTION_ONLY', 'SCHEDULE_I', 'SCHEDULE_II', 'SCHEDULE_III', 'SCHEDULE_IV', 'SCHEDULE_V', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "NafdacStatus" AS ENUM ('VALID', 'EXPIRED', 'PENDING', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapeuticClass" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "TherapeuticClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChemicalClass" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ChemicalClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenericMedication" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "inn" TEXT,
    "atcCode" TEXT,
    "description" TEXT,
    "translations" JSONB,

    CONSTRAINT "GenericMedication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenericMedicationCategory" (
    "genericMedicationId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,

    CONSTRAINT "GenericMedicationCategory_pkey" PRIMARY KEY ("genericMedicationId","categoryId")
);

-- CreateTable
CREATE TABLE "GenericMedicationTherapeuticClass" (
    "genericMedicationId" INTEGER NOT NULL,
    "therapeuticClassId" INTEGER NOT NULL,

    CONSTRAINT "GenericMedicationTherapeuticClass_pkey" PRIMARY KEY ("genericMedicationId","therapeuticClassId")
);

-- CreateTable
CREATE TABLE "GenericMedicationChemicalClass" (
    "genericMedicationId" INTEGER NOT NULL,
    "chemicalClassId" INTEGER NOT NULL,

    CONSTRAINT "GenericMedicationChemicalClass_pkey" PRIMARY KEY ("genericMedicationId","chemicalClassId")
);

-- CreateTable
CREATE TABLE "Indication" (
    "id" SERIAL NOT NULL,
    "genericMedicationId" INTEGER NOT NULL,
    "indication" TEXT NOT NULL,
    "translations" JSONB,

    CONSTRAINT "Indication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "contactInfo" TEXT,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pharmacy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "location" geometry,
    "address" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "pharmacyType" "PharmacyType" DEFAULT 'COMMUNITY',
    "status" "PharmacyStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ward" TEXT,
    "devicetoken" TEXT,
    "operatingHours" TEXT,
    "deliveryAvailability" BOOLEAN DEFAULT false,

    CONSTRAINT "Pharmacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAvailability" (
    "medicationId" INTEGER NOT NULL,
    "pharmacyId" INTEGER NOT NULL,
    "stock" INTEGER,
    "price" DOUBLE PRECISION,
    "receivedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "batchNumber" TEXT,

    CONSTRAINT "MedicationAvailability_pkey" PRIMARY KEY ("medicationId","pharmacyId")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" SERIAL NOT NULL,
    "medicationId" INTEGER NOT NULL,
    "pharmacyId" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugComponent" (
    "id" SERIAL NOT NULL,
    "medicationId" INTEGER NOT NULL,
    "genericMedicationId" INTEGER NOT NULL,
    "strength" DOUBLE PRECISION,
    "unit" "StrengthUnit",

    CONSTRAINT "DrugComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" SERIAL NOT NULL,
    "userIdentifier" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,
    "phone" TEXT,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionMedication" (
    "id" SERIAL NOT NULL,
    "prescriptionId" INTEGER NOT NULL,
    "medicationId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dosageInstructions" TEXT,

    CONSTRAINT "PrescriptionMedication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "userIdentifier" TEXT NOT NULL,
    "pharmacyId" INTEGER,
    "prescriptionId" INTEGER,
    "status" "OrderStatus" NOT NULL DEFAULT 'CART',
    "deliveryMethod" "DeliveryMethod" DEFAULT 'UNSPECIFIED',
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
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "PaymentMethod" DEFAULT 'PAY_NOW',
    "paymentChannel" TEXT,
    "checkoutSessionId" TEXT,
    "name" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "pharmacyId" INTEGER NOT NULL,
    "medicationId" INTEGER NOT NULL,
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
    "role" "PharmacyUserRole" NOT NULL DEFAULT 'MANAGER',
    "pharmacyId" INTEGER NOT NULL,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacyUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" SERIAL NOT NULL,
    "userIdentifier" TEXT NOT NULL,
    "consentType" "ConsentType" NOT NULL,
    "consentLanguage" TEXT,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyUserConsent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "consentType" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacyUserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionReference" (
    "id" SERIAL NOT NULL,
    "transactionReference" TEXT NOT NULL,
    "orderReferences" TEXT[],
    "checkoutSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "pharmacyId" INTEGER NOT NULL,
    "items" JSON NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" SERIAL NOT NULL,
    "brandName" TEXT NOT NULL,
    "genericMedicationId" INTEGER NOT NULL,
    "brandDescription" TEXT,
    "localNames" TEXT[],
    "manufacturerId" INTEGER,
    "form" "DosageForm",
    "strengthValue" DOUBLE PRECISION,
    "strengthUnit" "StrengthUnit",
    "route" "Route",
    "packSizeQuantity" INTEGER,
    "packSizeUnit" "PackSizeUnit",
    "isCombination" BOOLEAN NOT NULL DEFAULT false,
    "combinationDescription" TEXT,
    "nafdacCode" TEXT NOT NULL,
    "nafdacStatus" "NafdacStatus" DEFAULT 'PENDING',
    "prescriptionRequired" BOOLEAN NOT NULL,
    "regulatoryClass" "RegulatoryClass",
    "restrictedTo" "RestrictedTo",
    "insuranceCoverage" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvalDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "storageConditions" TEXT,
    "imageUrl" TEXT,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TherapeuticClass_name_key" ON "TherapeuticClass"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ChemicalClass_name_key" ON "ChemicalClass"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GenericMedication_name_key" ON "GenericMedication"("name");

-- CreateIndex
CREATE INDEX "GenericMedication_name_idx" ON "GenericMedication"("name");

-- CreateIndex
CREATE INDEX "GenericMedication_atcCode_idx" ON "GenericMedication"("atcCode");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_name_key" ON "Manufacturer"("name");

-- CreateIndex
CREATE INDEX "Manufacturer_name_idx" ON "Manufacturer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacy_licenseNumber_key" ON "Pharmacy"("licenseNumber");

-- CreateIndex
CREATE INDEX "Pharmacy_name_state_idx" ON "Pharmacy"("name", "state");

-- CreateIndex
CREATE INDEX "Pharmacy_licenseNumber_idx" ON "Pharmacy"("licenseNumber");

-- CreateIndex
CREATE INDEX "idx_pharmacy_location" ON "Pharmacy" USING GIST ("location");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_userIdentifier_key" ON "Prescription"("userIdentifier");

-- CreateIndex
CREATE INDEX "Prescription_userIdentifier_idx" ON "Prescription"("userIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentReference_key" ON "Order"("paymentReference");

-- CreateIndex
CREATE INDEX "Order_userIdentifier_idx" ON "Order"("userIdentifier");

-- CreateIndex
CREATE INDEX "Order_paymentReference_idx" ON "Order"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_pharmacyId_medicationId_key" ON "OrderItem"("orderId", "pharmacyId", "medicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyUser_email_key" ON "PharmacyUser"("email");

-- CreateIndex
CREATE INDEX "PharmacyUser_email_idx" ON "PharmacyUser"("email");

-- CreateIndex
CREATE INDEX "UserConsent_userIdentifier_idx" ON "UserConsent"("userIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "UserConsent_userIdentifier_consentType_key" ON "UserConsent"("userIdentifier", "consentType");

-- CreateIndex
CREATE INDEX "PharmacyUserConsent_userId_idx" ON "PharmacyUserConsent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyUserConsent_userId_consentType_key" ON "PharmacyUserConsent"("userId", "consentType");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionReference_transactionReference_key" ON "TransactionReference"("transactionReference");

-- CreateIndex
CREATE INDEX "TransactionReference_transactionReference_idx" ON "TransactionReference"("transactionReference");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_email_idx" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Medication_nafdacCode_key" ON "Medication"("nafdacCode");

-- CreateIndex
CREATE INDEX "Medication_genericMedicationId_idx" ON "Medication"("genericMedicationId");

-- CreateIndex
CREATE INDEX "Medication_nafdacCode_idx" ON "Medication"("nafdacCode");

-- CreateIndex
CREATE INDEX "Medication_form_idx" ON "Medication"("form");

-- CreateIndex
CREATE INDEX "Medication_route_idx" ON "Medication"("route");

-- AddForeignKey
ALTER TABLE "GenericMedicationCategory" ADD CONSTRAINT "GenericMedicationCategory_genericMedicationId_fkey" FOREIGN KEY ("genericMedicationId") REFERENCES "GenericMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericMedicationCategory" ADD CONSTRAINT "GenericMedicationCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericMedicationTherapeuticClass" ADD CONSTRAINT "GenericMedicationTherapeuticClass_genericMedicationId_fkey" FOREIGN KEY ("genericMedicationId") REFERENCES "GenericMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericMedicationTherapeuticClass" ADD CONSTRAINT "GenericMedicationTherapeuticClass_therapeuticClassId_fkey" FOREIGN KEY ("therapeuticClassId") REFERENCES "TherapeuticClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericMedicationChemicalClass" ADD CONSTRAINT "GenericMedicationChemicalClass_genericMedicationId_fkey" FOREIGN KEY ("genericMedicationId") REFERENCES "GenericMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericMedicationChemicalClass" ADD CONSTRAINT "GenericMedicationChemicalClass_chemicalClassId_fkey" FOREIGN KEY ("chemicalClassId") REFERENCES "ChemicalClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Indication" ADD CONSTRAINT "Indication_genericMedicationId_fkey" FOREIGN KEY ("genericMedicationId") REFERENCES "GenericMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAvailability" ADD CONSTRAINT "MedicationAvailability_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAvailability" ADD CONSTRAINT "MedicationAvailability_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_medicationId_pharmacyId_fkey" FOREIGN KEY ("medicationId", "pharmacyId") REFERENCES "MedicationAvailability"("medicationId", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugComponent" ADD CONSTRAINT "DrugComponent_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugComponent" ADD CONSTRAINT "DrugComponent_genericMedicationId_fkey" FOREIGN KEY ("genericMedicationId") REFERENCES "GenericMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionMedication" ADD CONSTRAINT "PrescriptionMedication_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PrescriptionMedication" ADD CONSTRAINT "PrescriptionMedication_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pharmacyId_medicationId_fkey" FOREIGN KEY ("pharmacyId", "medicationId") REFERENCES "MedicationAvailability"("pharmacyId", "medicationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyUser" ADD CONSTRAINT "PharmacyUser_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userIdentifier_fkey" FOREIGN KEY ("userIdentifier") REFERENCES "Prescription"("userIdentifier") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyUserConsent" ADD CONSTRAINT "PharmacyUserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "PharmacyUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "fk_pharmacy" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_genericMedicationId_fkey" FOREIGN KEY ("genericMedicationId") REFERENCES "GenericMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
