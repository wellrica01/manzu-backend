const { PrismaClient } = require('@prisma/client');
const { normalizePhone } = require('../utils/validation');
const { sendVerificationNotification } = require('../utils/notifications');
const prisma = new PrismaClient();

async function uploadPrescription({ userIdentifier, email, phone, fileUrl }) {
  const normalizedPhone = phone ? normalizePhone(phone) : phone;
  const prescription = await prisma.prescription.create({
    data: {
      userIdentifier,
      email: email || null,
      phone: normalizedPhone,
      fileUrl,
      status: 'PENDING',
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

  const result = await prisma.$transaction(async (tx) => {
    const prescriptionMedications = [];
    for (const med of medications) {
      const { medicationId, quantity, dosageInstructions } = med;
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
          dosageInstructions: dosageInstructions || null,
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
  const upperStatus = status.toUpperCase();
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      orders: {
        include: {
          pharmacy: true,
          items: {
            include: {
              medicationAvailability: {
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
  if (prescription.status !== 'PENDING') {
    throw new Error('Prescription is already processed');
  }

  const updatedPrescription = await prisma.$transaction(async (tx) => {
    const prescriptionUpdate = await tx.prescription.update({
      where: { id: prescriptionId },
      data: {
        status: upperStatus,
      },
    });

    if (prescription.orders && prescription.orders.length > 0) {
      if (upperStatus === 'REJECTED') {
        for (const order of prescription.orders) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'PENDING_PRESCRIPTION',
              updatedAt: new Date(),
            },
          });
        }
      } else if (upperStatus === 'VERIFIED') {
        for (const order of prescription.orders) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'PENDING',
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
      await sendVerificationNotification(updatedPrescription, upperStatus, order);
    }
  }

  console.log('Prescription updated:', { prescriptionId: updatedPrescription.id, status: upperStatus });
  return updatedPrescription;
}


async function retrievePrescription({ email, phone }) {
  let guestId = null;

  if (email || phone) {
    const orConditions = [];
    if (email) orConditions.push({ email });
    if (phone) orConditions.push({ phone: normalizePhone(phone) });

    console.log('OR conditions:', JSON.stringify(orConditions));

    const prescriptionQuery = {
      where: { ...(orConditions.length > 0 && { OR: orConditions }) },
      select: { userIdentifier: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    };

    console.log('Prescription query:', JSON.stringify(prescriptionQuery));

    const prescription = await prisma.prescription.findFirst(prescriptionQuery);

    console.log('Prescription result:', prescription);

    if (prescription) {
      guestId = prescription.userIdentifier;
      console.log('Selected guestId:', guestId);
    }
  }

  return guestId; // Will be null if not found
}


async function getPrescriptionOrder({ userIdentifier, lat, lng, radius, state, lga, ward }) {
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radiusKm = parseFloat(radius);
  const hasValidCoordinates = lat && lng && !isNaN(userLat) && !isNaN(userLng) && !isNaN(radiusKm);

  if (hasValidCoordinates && (userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180)) {
    throw new Error('Invalid latitude or longitude');
  }

  const prescription = await prisma.prescription.findFirst({
    where: { userIdentifier, status: { in: ['PENDING', 'VERIFIED'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      prescriptionMedications: {
        include: {
          medication: {
            select: {
              id: true,
              brandName: true,
              fullName: true,
              manufacturer: { select: { name: true, country: true } },
              form: true,
              strengthValue: true,
              strengthUnit: true,
              route: true,
              packSizeQuantity: true,
              packSizeUnit: true,
              prescriptionRequired: true,
              nafdacCode: true,
              imageUrl: true,
              genericMedication: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!prescription) {
    throw new Error('Prescription not found or not verified');
  }

  if (prescription.status === 'PENDING') {
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
      pharmacyRecommendations: [],
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
      AND status = 'VERIFIED'
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
    prescription.prescriptionMedications.map(async prescriptionMed => {
      const medication = prescriptionMed.medication;
      let pharmacyFilter = {
        medicationId: medication.id,
        stock: { gte: prescriptionMed.quantity },
        pharmacy: {
          status: 'VERIFIED',
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
      const availability = await prisma.medicationAvailability.findMany({
        where: pharmacyFilter,
        include: {
          pharmacy: { 
            select: {
              id: true,
              name: true,
              address: true,
              phone: true,
              logoUrl: true,
              licenseNumber: true,
              status: true,
              isActive: true,
              ward: true,
              lga: true,
              state: true,
              OperatingHour: {
                select: {
                  dayOfWeek: true,
                  openTime: true,
                  closeTime: true,
                },
              },
            },
          },
        },
      });

      return {
        id: medication.id,
        fullName: medication.fullName,
        quantity: prescriptionMed.quantity,
        dosageInstructions: prescriptionMed.dosageInstructions,
        genericName: medication.genericMedication?.name,
        manufacturerName: medication.manufacturer?.name || null,
        manufacturerCountry: medication.manufacturer?.country || null,
        form: medication.form,
        strengthValue: medication.strengthValue,
        strengthUnit: medication.strengthUnit,
        route: medication.route,
        packSizeQuantity: medication.packSizeQuantity,
        packSizeUnit: medication.packSizeUnit,
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
          logoUrl: avail.pharmacy.logoUrl,
          isActive: avail.pharmacy.isActive,
          ward: avail.pharmacy.ward,
          lga: avail.pharmacy.lga,
          state: avail.pharmacy.state,
          operatingHours: avail.pharmacy.OperatingHour.map(h => ({
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime instanceof Date 
              ? h.openTime.toISOString().slice(11,16)
              : h.openTime,
            closeTime: h.closeTime instanceof Date
              ? h.closeTime.toISOString().slice(11,16)
              : h.closeTime,
          })),
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

  // Compute pharmacy recommendations
  const medicationIds = prescription.prescriptionMedications.map(pm => pm.medicationId);
  let recommendationFilter = {
    medicationId: { in: medicationIds },
    stock: { gte: 1 }, // Ensure sufficient stock (can refine to match prescriptionMed.quantity)
    pharmacy: {
      status: 'VERIFIED',
      isActive: true,
    },
  };
  if (state) {
    recommendationFilter.pharmacy.state = { equals: state, mode: 'insensitive' };
  }
  if (lga) {
    recommendationFilter.pharmacy.lga = { equals: lga, mode: 'insensitive' };
  }
  if (ward) {
    recommendationFilter.pharmacy.ward = { equals: ward, mode: 'insensitive' };
  }
  if (hasValidCoordinates) {
    recommendationFilter.pharmacy.id = {
      in: pharmacyIdsWithDistance.length > 0
        ? pharmacyIdsWithDistance.map(p => p.id)
        : [-1],
    };
  }

const pharmacyRecommendations = await prisma.medicationAvailability.groupBy({
  by: ['pharmacyId'],
  where: recommendationFilter,
  _count: { medicationId: true },
  _sum: { price: true },
}).then(async (grouped) => {
  const pharmacyIds = grouped.map(g => g.pharmacyId);
  const pharmacies = await prisma.pharmacy.findMany({
    where: { id: { in: pharmacyIds }, status: 'VERIFIED', isActive: true },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      logoUrl: true,
      licenseNumber: true,
      status: true,
      isActive: true,
      ward: true,
      lga: true,
      state: true,
      OperatingHour: {
        select: {
          dayOfWeek: true,
          openTime: true,
          closeTime: true,
        },
      },
    },
  });

  const availabilityDetails = await prisma.medicationAvailability.findMany({
    where: {
      pharmacyId: { in: pharmacyIds },
      medicationId: { in: medicationIds },
      stock: { gte: 1 },
    },
    select: {
      pharmacyId: true,
      medicationId: true,
      price: true,
      stock: true,
      expiryDate: true,
      medication: {
        select: {
          id: true,
          fullName: true,
        },
      },
    },
  });

  return grouped.map(group => {
    const pharmacy = pharmacies.find(p => p.id === group.pharmacyId);
    if (!pharmacy) return null;

    const meds = availabilityDetails
      .filter(ad => ad.pharmacyId === group.pharmacyId)
      .map(ad => ({
        id: ad.medicationId,
        fullName: ad.medication.fullName,
        price: ad.price,
      }));

    return {
      pharmacyId: group.pharmacyId,
      pharmacyName: pharmacy.name,
      address: pharmacy.address,
      phone: pharmacy.phone || null,
      logoUrl: pharmacy.logoUrl || null,
      licenseNumber: pharmacy.licenseNumber || null,
      status: pharmacy.status,
      isActive: pharmacy.isActive,
      ward: pharmacy.ward || null,
      lga: pharmacy.lga || null,
      state: pharmacy.state || null,
      operatingHours: pharmacy.OperatingHour.map(h => ({
        dayOfWeek: h.dayOfWeek,
        openTime: h.openTime instanceof Date 
          ? h.openTime.toISOString().slice(11,16)
          : h.openTime,
        closeTime: h.closeTime instanceof Date
          ? h.closeTime.toISOString().slice(11,16)
          : h.closeTime,
      })),
      meds,
      totalPrice: group._sum.price || 0,
      medCount: group._count.medicationId,
      distance_km: distanceMap.has(group.pharmacyId)
        ? distanceMap.get(group.pharmacyId)
        : null,
    };
  }).filter(Boolean).sort((a, b) => b.medCount - a.medCount);
});

  const order = await prisma.order.findFirst({
    where: {
      userIdentifier,
      prescriptionId: prescription.id,
      status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED'] },
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
    pharmacyRecommendations,
  };
}

async function getPrescriptionStatuses({ userIdentifier, medicationIds }) {
  try {
    const validMedicationIds = medicationIds.filter(id => id && !isNaN(parseInt(id))).map(id => id.toString());
    if (validMedicationIds.length === 0) {
      console.warn('No valid medication IDs provided:', { userIdentifier, medicationIds });
      return Object.fromEntries(medicationIds.map(id => [id, 'NONE']));
    }

    const prescription = await prisma.prescription.findFirst({
      where: { 
        userIdentifier, 
        status: { in: ['PENDING', 'VERIFIED'] } 
      },
      orderBy: { createdAt: 'desc' },
      include: {
        prescriptionMedications: {
          include: {
            medication: {
              select: { id: true },
            },
          },
        },
      },
    });

    const statuses = Object.fromEntries(
      validMedicationIds.map(id => [id, 'NONE'])
    );

    if (!prescription) {
      console.log('No prescription found for user:', { userIdentifier });
      return statuses;
    }

    const coveredMedicationIds = prescription.prescriptionMedications
      .map(pm => pm.medicationId.toString());

    for (const medId of validMedicationIds) {
      if (coveredMedicationIds.includes(medId)) {
        statuses[medId] = prescription.status; // 'VERIFIED' or 'PENDING'
      }
    }

    console.log('Prescription statuses retrieved:', { userIdentifier, statuses });
    return statuses;
  } catch (error) {
    console.error('Error fetching prescription statuses:', error);
    throw new Error('Failed to fetch prescription statuses');
  }
}

module.exports = { uploadPrescription, addMedications, verifyPrescription, retrievePrescription, getPrescriptionOrder, getPrescriptionStatuses };