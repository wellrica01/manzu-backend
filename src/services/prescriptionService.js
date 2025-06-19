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
      email,
      phone: normalizedPhone,
      fileUrl,
      status: 'pending',
      verified: false,
    },
  });
  console.log('Prescription uploaded:', { prescriptionId: prescription.id });
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

  console.log('Medications added:', { prescriptionId });
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
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'cancelled',
              cancelReason: 'Prescription rejected',
              cancelledAt: new Date(),
            },
          });

          if (order.items && order.items.length > 0) {
            for (const item of order.items) {
              await tx.pharmacyMedication.update({
                where: {
                  pharmacyId_medicationId: {
                    pharmacyId: item.pharmacyMedicationPharmacyId,
                    medicationId: item.pharmacyMedicationMedicationId,
                  },
                },
                data: {
                  stock: { increment: item.quantity },
                },
              });
            }
          }
        }
      } else if (status === 'verified') {
        for (const order of prescription.orders) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'pending',
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

async function getGuestOrder({ patientIdentifier, lat, lng, radius }) {
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
  if (prescription.status === 'pending') {
    throw new Error('Prescription is still under review. You’ll be notified when it’s ready.');
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
      const availability = await prisma.pharmacyMedication.findMany({
        where: {
          medicationId: medication.id,
          stock: { gte: prescriptionMed.quantity },
          pharmacy: {
            status: 'verified',
            isActive: true,
            ...(hasValidCoordinates && {
              id: {
                in: pharmacyIdsWithDistance.length > 0
                  ? pharmacyIdsWithDistance.map(p => p.id)
                  : [-1],
              },
            }),
          },
        },
        include: {
          pharmacy: { select: { id: true, name: true, address: true } },
        },
      });

      return {
        id: medication.id,
        displayName: formatDisplayName(medication),
        quantity: prescriptionMed.quantity,
        genericName: medication.genericName,
        prescriptionRequired: medication.prescriptionRequired,
        nafdacCode: medication.nafdacCode,
        imageUrl: medication.imageUrl,
        availability: availability.map(avail => ({
          pharmacyId: avail.pharmacy.id,
          pharmacyName: avail.pharmacy.name,
          address: avail.pharmacy.address,
          price: avail.price,
          distance_km: distanceMap.has(avail.pharmacy.id)
            ? distanceMap.get(avail.pharmacy.id)
            : null,
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

module.exports = { uploadPrescription, addMedications, verifyPrescription, getGuestOrder };