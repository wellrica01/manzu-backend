const { PrismaClient } = require('@prisma/client');
const { normalizePhone } = require('../utils/validation');
const { sendVerificationNotification } = require('../utils/notifications');
const { formatDisplayName } = require('../utils/medicationUtils');
const prisma = new PrismaClient();

async function uploadPrescription({ patientIdentifier, email, phone, fileUrl }) {
  const normalizedPhone = phone ? normalizePhone(phone) : phone;
  const prescription = await prisma.prescription.create({
    data: {
      patientIdentifier,
      email: email || null,
      phone: normalizedPhone,
      fileUrl,
      status: 'pending',
      verified: false,
    },
  });
  console.log('Prescription uploaded:', { prescriptionId: prescription.id, email, phone: normalizedPhone });
  return prescription;
}


async function addMedications(prescriptionId, medications) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
  });
  if (!prescription) {
    throw new Error('Prescription not found');
  }
  if (prescription.status !== 'pending') {
    throw new Error('Prescription is already processed');
  }

  const result = await prisma.$transaction(async (tx) => {
    const prescriptionMedications = [];
    for (const med of medications) {
      const { medicationId, quantity } = med;
      const medication = await tx.medication.findUnique({
        where: { id: Number(medicationId) },
      });
      if (!medication) {
        throw new Error(`Medication ${medicationId} not found`);
      }
      const prescriptionMedication = await tx.prescriptionMedication.create({
        data: {
          prescriptionId,
          medicationId: Number(medicationId),
          quantity,
        },
      });
      prescriptionMedications.push(prescriptionMedication);
    }
    return { prescriptionMedications };
  });

  console.log('Medications added:', { prescriptionId, medications: result.prescriptionMedications });

  return result;
}

async function verifyPrescription(prescriptionId, status) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      orders: {
        include: {
          pharmacy: true,
          items: {
            include: {
              pharmacyMedication: {
                include: { medication: true },
              },
            },
          },
        },
      },
    },
  });
  if (!prescription) {
    throw new Error('Prescription not found');
  }
  if (prescription.status !== 'pending') {
    throw new Error('Prescription is already processed');
  }

  const updatedPrescription = await prisma.$transaction(async (tx) => {
    const prescriptionUpdate = await tx.prescription.update({
      where: { id: prescriptionId },
      data: {
        status,
        verified: status === 'verified',
      },
    });

    if (prescription.orders && prescription.orders.length > 0) {
      if (status === 'rejected') {
        for (const order of prescription.orders) {
          // For rejected prescriptions, keep order in pending_prescription status
          // so user can upload new prescription
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'pending_prescription',
              updatedAt: new Date(),
            },
          });
        }
      } else if (status === 'verified') {
        for (const order of prescription.orders) {
          // For verified prescriptions, update order to pending for checkout
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'pending',
              updatedAt: new Date(),
            },
          });
        }
      }
    }

    return prescriptionUpdate;
  });

  if (prescription.orders && prescription.orders.length > 0) {
    for (const order of prescription.orders) {
      await sendVerificationNotification(updatedPrescription, status, order);
    }
  }

  console.log('Prescription updated:', { prescriptionId: updatedPrescription.id, status });
  return updatedPrescription;
}

async function getPrescriptionOrder({ patientIdentifier, lat, lng, radius, state, lga, ward }) {
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radiusKm = parseFloat(radius);
  const hasValidCoordinates = lat && lng && !isNaN(userLat) && !isNaN(userLng) && !isNaN(radiusKm);

  if (hasValidCoordinates && (userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180)) {
    throw new Error('Invalid latitude or longitude');
  }

  const prescription = await prisma.prescription.findFirst({
    where: { patientIdentifier, status: { in: ['pending', 'verified'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      PrescriptionMedication: {
        include: {
          Medication: {
            select: { id: true, name: true, dosage: true, form: true, genericName: true, prescriptionRequired: true, nafdacCode: true, imageUrl: true },
          },
        },
      },
    },
  });

  if (!prescription) {
    throw new Error('Prescription not found or not verified');
  }

  // For pending prescriptions, return metadata without medications or order details
  if (prescription.status === 'pending') {
    return {
      medications: [],
      prescriptionId: prescription.id,
      orderId: null,
      orderStatus: null,
      prescriptionMetadata: {
        id: prescription.id,
        uploadedAt: prescription.createdAt,
        status: prescription.status,
        fileUrl: prescription.fileUrl,
      },
    };
  }

  let pharmacyIdsWithDistance = [];
  if (hasValidCoordinates) {
    pharmacyIdsWithDistance = await prisma.$queryRaw`
      SELECT 
        id,
        ST_DistanceSphere(
          location,
          ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326)
        ) / 1000 AS distance_km
      FROM "Pharmacy"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326),
        ${radiusKm} * 1000
      )
      AND status = 'verified'
      AND "isActive" = true
    `.then(results =>
      results.map(r => ({
        id: Number(r.id),
        distance_km: parseFloat(r.distance_km.toFixed(1)),
      }))
    );
  }

  const distanceMap = new Map(
    pharmacyIdsWithDistance.map(entry => [entry.id, entry.distance_km])
  );

  const medications = await Promise.all(
    prescription.PrescriptionMedication.map(async prescriptionMed => {
      const medication = prescriptionMed.Medication;
      // Build pharmacy filter (like in searchMedications)
      let pharmacyFilter = {
        medicationId: medication.id,
        stock: { gte: prescriptionMed.quantity },
        pharmacy: {
          status: 'verified',
          isActive: true,
        },
      };
      if (state) {
        pharmacyFilter.pharmacy.state = { equals: state, mode: 'insensitive' };
      }
      if (lga) {
        pharmacyFilter.pharmacy.lga = { equals: lga, mode: 'insensitive' };
      }
      if (ward) {
        pharmacyFilter.pharmacy.ward = { equals: ward, mode: 'insensitive' };
      }
      if (hasValidCoordinates) {
        pharmacyFilter.pharmacy.id = {
          in: pharmacyIdsWithDistance.length > 0
            ? pharmacyIdsWithDistance.map(p => p.id)
            : [-1],
        };
      }
      const availability = await prisma.pharmacyMedication.findMany({
        where: pharmacyFilter,
        include: {
          pharmacy: { select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            licenseNumber: true,
            status: true,
            isActive: true,
            ward: true,
            lga: true,
            state: true,
            operatingHours: true,
          } },
        },
      });

      return {
        id: medication.id,
        displayName: formatDisplayName(medication),
        quantity: prescriptionMed.quantity,
        genericName: medication.genericName,
        description: medication.description,
        manufacturer: medication.manufacturer,
        form: medication.form,
        dosage: medication.dosage,
        prescriptionRequired: medication.prescriptionRequired,
        nafdacCode: medication.nafdacCode,
        imageUrl: medication.imageUrl,
        availability: availability.map(avail => ({
          pharmacyId: avail.pharmacy.id,
          pharmacyName: avail.pharmacy.name,
          address: avail.pharmacy.address,
          phone: avail.pharmacy.phone || null,
          licenseNumber: avail.pharmacy.licenseNumber || null,
          status: avail.pharmacy.status,
          isActive: avail.pharmacy.isActive,
          ward: avail.pharmacy.ward,
          lga: avail.pharmacy.lga,
          state: avail.pharmacy.state,
          operatingHours: avail.pharmacy.operatingHours,
          stock: avail.stock,
          price: avail.price,
          expiryDate: avail.expiryDate || null,
          distance_km: distanceMap.has(avail.pharmacy.id)
            ? distanceMap.get(avail.pharmacy.id)
            : null,
          latitude: avail.pharmacy.latitude || null,
          longitude: avail.pharmacy.longitude || null,
        })),
      };
    })
  );

  const order = await prisma.order.findFirst({
    where: {
      patientIdentifier,
      prescriptionId: prescription.id,
      status: { in: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    medications,
    prescriptionId: prescription.id,
    orderId: order?.id,
    orderStatus: order?.status,
    prescriptionMetadata: {
      id: prescription.id,
      uploadedAt: prescription.createdAt,
      status: prescription.status,
      fileUrl: prescription.fileUrl,
    },
  };
}

async function getPrescriptionStatuses({ patientIdentifier, medicationIds }) {
  try {
    // Validate medicationIds
    const validMedicationIds = medicationIds.filter(id => id && !isNaN(parseInt(id))).map(id => id.toString());
    if (validMedicationIds.length === 0) {
      console.warn('No valid medication IDs provided:', { patientIdentifier, medicationIds });
      return Object.fromEntries(medicationIds.map(id => [id, 'none']));
    }

    // Fetch the latest prescription for the patient
    const prescription = await prisma.prescription.findFirst({
      where: { 
        patientIdentifier, 
        status: { in: ['pending', 'verified'] } 
      },
      orderBy: { createdAt: 'desc' },
      include: {
        PrescriptionMedication: {
          include: {
            Medication: {
              select: { id: true },
            },
          },
        },
      },
    });

    // Initialize statuses as 'none' for all requested medicationIds
    const statuses = Object.fromEntries(
      validMedicationIds.map(id => [id, 'none'])
    );

    if (!prescription) {
      console.log('No prescription found for patient:', { patientIdentifier });
      return statuses;
    }

    // Map medicationIds covered by the prescription
    const coveredMedicationIds = prescription.PrescriptionMedication
      .map(pm => pm.medicationId.toString());

    for (const medId of validMedicationIds) {
      if (coveredMedicationIds.includes(medId)) {
        statuses[medId] = prescription.status; // 'verified' or 'pending'
      }
    }

    console.log('Prescription statuses retrieved:', { patientIdentifier, statuses });
    return statuses;
  } catch (error) {
    console.error('Error fetching prescription statuses:', error);
    throw new Error('Failed to fetch prescription statuses');
  }
}

module.exports = { uploadPrescription, addMedications, verifyPrescription, getPrescriptionOrder, getPrescriptionStatuses };