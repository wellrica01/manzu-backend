const { PrismaClient } = require('@prisma/client');
const { normalizePhone } = require('../utils/validation');
const { sendVerificationNotification } = require('../utils/notifications');
const { capitalize, formatPerUnitType, formatPackSizeUnit, formatStrengthUnit, resolveManufacturer, computePackSizeQuantity, linkIngredients } = require('../utils/medicationUtils')
const { createAuditLog, AUDIT_ACTIONS, ENTITY_TYPES } = require('../utils/audit-logger');

const prisma = new PrismaClient();

// Prescription expiry periods (in days)
const EXPIRY_PERIODS = {
  STANDARD: 30,    // Standard prescriptions
  CONTROLLED: 7,   // Controlled substances
  CHRONIC: 90,     // Chronic conditions
};

// Helper to calculate expiry date
function calculateExpiryDate(type = 'STANDARD', customDays = null) {
  const days = customDays || EXPIRY_PERIODS[type] || EXPIRY_PERIODS.STANDARD;
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);
  return expiryDate;
}

async function uploadPrescription({ userIdentifier, email, phone, fileUrl, prescriptionType = 'STANDARD', expiryDays = null }) {
  const normalizedPhone = phone ? normalizePhone(phone) : phone;
  
  // Calculate expiry date based on prescription type
  const expiryDate = calculateExpiryDate(prescriptionType, expiryDays);
  const finalExpiryDays = expiryDays || EXPIRY_PERIODS[prescriptionType] || EXPIRY_PERIODS.STANDARD;
  
  const prescription = await prisma.prescription.create({
    data: {
      userIdentifier,
      email: email || null,
      phone: normalizedPhone,
      fileUrl,
      status: 'PENDING',
      expiryDate,
      expiryDays: finalExpiryDays,
    },
  });
  
  console.log('Prescription uploaded:', { 
    prescriptionId: prescription.id, 
    email, 
    phone: normalizedPhone,
    expiryDate,
    expiryDays: finalExpiryDays
  });
  
  return prescription;
}


async function validatePrescriptionExpiry(prescriptionId) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    select: { status: true, expiryDate: true }
  });

  if (!prescription) {
    throw new Error('Prescription not found');
  }

  if (prescription.status === 'EXPIRED') {
    throw new Error('Prescription has expired. Please upload a new prescription.');
  }

  if (prescription.expiryDate && new Date() > new Date(prescription.expiryDate)) {
    // Mark as expired if not already
    await prisma.prescription.update({
      where: { id: prescriptionId },
      data: { status: 'EXPIRED', updatedAt: new Date() }
    });
    throw new Error('Prescription has expired. Please upload a new prescription.');
  }

  return true;
}

async function addMedications(prescriptionId, medications) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
  });
  if (!prescription) {
    throw new Error('Prescription not found');
  }

  const result = await prisma.$transaction(async (tx) => {
    const PrescriptionMedication = [];
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
      PrescriptionMedication.push(prescriptionMedication);
    }
    return { PrescriptionMedication };
  });

  console.log('Medications added:', { prescriptionId, medications: result.PrescriptionMedication });

  return result;
}

async function verifyPrescription(prescriptionId, status) {
  const upperStatus = status.toUpperCase();
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      Order: {
        include: {
          Pharmacy: true,
          OrderItem: {
            include: {
              MedicationAvailability: {
                include: { Medication: true },
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

  const updatedPrescription = await prisma.$transaction(async (tx) => {
    const prescriptionUpdate = await tx.prescription.update({
      where: { id: prescriptionId },
      data: {
        status: upperStatus,
      },
    });

    if (prescription.Order && prescription.Order.length > 0) {
      if (upperStatus === 'REJECTED') {
        for (const order of prescription.Order) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'PENDING_PRESCRIPTION',
              updatedAt: new Date(),
            },
          });
        }
      } else if (upperStatus === 'VERIFIED') {
        for (const order of prescription.Order) {
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

    // Audit log for prescription status change
    const auditAction = upperStatus === 'VERIFIED' 
      ? AUDIT_ACTIONS.PRESCRIPTION_VERIFIED 
      : upperStatus === 'REJECTED'
      ? AUDIT_ACTIONS.PRESCRIPTION_REJECTED
      : null;
    
    if (auditAction) {
      await createAuditLog({
        action: auditAction,
        entityType: ENTITY_TYPES.PRESCRIPTION,
        entityId: prescriptionId,
        details: {
          previousStatus: prescription.status,
          newStatus: upperStatus,
          affectedOrders: prescription.Order?.map(o => o.id) || []
        },
        tx
      });
    }

    return prescriptionUpdate;
  });

  if (prescription.Order && prescription.Order.length > 0) {
    for (const order of prescription.Order) {
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

  // ✅ NEW: Check if any location filter is provided
  const hasLocationFilter = hasValidCoordinates || state || lga || ward;

  const prescription = await prisma.prescription.findFirst({
    where: { userIdentifier, status: { in: ['PENDING', 'VERIFIED'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      PrescriptionMedication: {
        include: {
          Medication: {
            include: {
              Medication_MedicationIngredient: {
                select: {
                  MedicationIngredient: {
                    select: {
                      strengthValue: true,
                      strengthUnit: true,
                      ActiveSubstance: { select: { name: true } }
                    }
                  }
                }
              },
              Manufacturer: true,
            }
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
        email: prescription.email,
        phone: prescription.phone,
        fileUrl: prescription.fileUrl,
      },
      pharmacyRecommendations: [],
    };
  }

  // ✅ NEW: If no location filter is provided, return medications without pharmacy data
  if (!hasLocationFilter) {
    const medicationsWithoutPharmacies = await Promise.all(
      prescription.PrescriptionMedication.map(async prescriptionMed => {
        const medication = prescriptionMed.Medication;
        
        const medicationIngredients = await prisma.medication_MedicationIngredient.findMany({
          where: { medicationId: medication.id },
          select: {
            MedicationIngredient: {
              select: {
                strengthValue: true,
                strengthUnit: true,
                ActiveSubstance: { 
                  select: { name: true } 
                }
              }
            }
          }
        });

        const activeSubstanceNames = medicationIngredients.map(
          mi => mi.MedicationIngredient.ActiveSubstance.name
        );

        const ingredients = medication?.Medication_MedicationIngredient?.map(mi => ({
          strengthValue: mi.MedicationIngredient.strengthValue,
          strengthUnit: formatStrengthUnit(mi.MedicationIngredient.strengthUnit),
          perUnitValue: mi.MedicationIngredient.perUnitValue,
          perUnitType: formatPerUnitType(mi.MedicationIngredient.perUnitType),
          activeSubstance: mi.MedicationIngredient.ActiveSubstance?.name,
        })) ?? [];

        return {
          id: medication.id,
          quantity: prescriptionMed.quantity,
          dosageInstructions: prescriptionMed.dosageInstructions,
          activeSubstances: activeSubstanceNames,
          manufacturerName: medication.Manufacturer?.name || null,
          manufacturerCountry: medication.Manufacturer?.country || null,
          form: medication.form,
          packSizeExpression: medication.packSizeExpression,
          packSizeQuantity: medication.packSizeQuantity,
          packSizeUnit: formatPackSizeUnit(medication.packSizeUnit),
          prescriptionRequired: medication.prescriptionRequired,
          nafdacCode: medication.nafdacCode,
          imageUrl: medication.imageUrl,
          ingredients,
          displayName: medication?.brandName
            ? `${medication.brandName}${medication.pharmacopeia ? ` ${medication.pharmacopeia}` : ''}${medication.form ? ` (${capitalize(medication.form)})` : ''}`
            : "Unknown",
          availability: [], // ✅ Empty availability when no filters
        };
      })
    );

    return {
      medications: medicationsWithoutPharmacies,
      prescriptionId: prescription.id,
      orderId: null,
      orderStatus: null,
      prescriptionMetadata: {
        id: prescription.id,
        uploadedAt: prescription.createdAt,
        status: prescription.status,
        email: prescription.email,
        phone: prescription.phone,
        fileUrl: prescription.fileUrl,
      },
      pharmacyRecommendations: [], // ✅ Empty recommendations when no filters
    };
  }

  // ✅ EXISTING: Continue with normal pharmacy fetching logic when filters are provided
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
    prescription.PrescriptionMedication.map(async prescriptionMed => {
      const medication = prescriptionMed.Medication;
      
      // Fetch active substances and their strengths for this medication
      const medicationIngredients = await prisma.medication_MedicationIngredient.findMany({
        where: { medicationId: medication.id },
        select: {
          MedicationIngredient: {
            select: {
              strengthValue: true,
              strengthUnit: true,
              ActiveSubstance: { 
                select: { name: true } 
              }
            }
          }
        }
      });

      const activeSubstanceNames = medicationIngredients.map(
        mi => mi.MedicationIngredient.ActiveSubstance.name
      );

      let pharmacyFilter = {
        medicationId: medication.id,
        stock: { gte: prescriptionMed.quantity },
        Pharmacy: {
          status: 'VERIFIED',
          isActive: true,
        },
      };
      if (state) {
        pharmacyFilter.Pharmacy.state = { equals: state, mode: 'insensitive' };
      }
      if (lga) {
        pharmacyFilter.Pharmacy.lga = { equals: lga, mode: 'insensitive' };
      }
      if (ward) {
        pharmacyFilter.Pharmacy.ward = { equals: ward, mode: 'insensitive' };
      }
      if (hasValidCoordinates) {
        pharmacyFilter.Pharmacy.id = {
          in: pharmacyIdsWithDistance.length > 0
            ? pharmacyIdsWithDistance.map(p => p.id)
            : [-1],
        };
      }
      const availability = await prisma.medicationAvailability.findMany({
        where: pharmacyFilter,
        include: {
          Pharmacy: { 
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

      const ingredients = medication?.Medication_MedicationIngredient?.map(mi => ({
        strengthValue: mi.MedicationIngredient.strengthValue,
        strengthUnit: formatStrengthUnit(mi.MedicationIngredient.strengthUnit),
        perUnitValue: mi.MedicationIngredient.perUnitValue,
        perUnitType: formatPerUnitType(mi.MedicationIngredient.perUnitType),
        activeSubstance: mi.MedicationIngredient.ActiveSubstance?.name,
      })) ?? [];

      return {
        id: medication.id,
        quantity: prescriptionMed.quantity,
        dosageInstructions: prescriptionMed.dosageInstructions,
        activeSubstances: activeSubstanceNames,
        manufacturerName: medication.Manufacturer?.name || null,
        manufacturerCountry: medication.Manufacturer?.country || null,
        form: medication.form,
        packSizeExpression: medication.packSizeExpression,
        packSizeQuantity: medication.packSizeQuantity,
        packSizeUnit: formatPackSizeUnit(medication.packSizeUnit),
        prescriptionRequired: medication.prescriptionRequired,
        nafdacCode: medication.nafdacCode,
        imageUrl: medication.imageUrl,
        ingredients,
        displayName: medication?.brandName
          ? `${medication.brandName}${medication.pharmacopeia ? ` ${medication.pharmacopeia}` : ''}${medication.form ? ` (${capitalize(medication.form)})` : ''}`
          : "Unknown",
        availability: availability.map(avail => ({
          pharmacyId: avail.Pharmacy.id,
          pharmacyName: avail.Pharmacy.name,
          address: avail.Pharmacy.address,
          phone: avail.Pharmacy.phone || null,
          licenseNumber: avail.Pharmacy.licenseNumber || null,
          status: avail.Pharmacy.status,
          logoUrl: avail.Pharmacy.logoUrl,
          isActive: avail.Pharmacy.isActive,
          ward: avail.Pharmacy.ward,
          lga: avail.Pharmacy.lga,
          state: avail.Pharmacy.state,
          operatingHours: avail.Pharmacy.OperatingHour.map(h => ({
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
          distance_km: distanceMap.has(avail.Pharmacy.id)
            ? distanceMap.get(avail.Pharmacy.id)
            : null,
        })),
      };
    })
  );

  // Compute pharmacy recommendations
  const medicationIds = prescription.PrescriptionMedication.map(pm => pm.medicationId);
  let recommendationFilter = {
    medicationId: { in: medicationIds },
    stock: { gte: 1 }, // Ensure sufficient stock (can refine to match prescriptionMed.quantity)
    Pharmacy: {
      status: 'VERIFIED',
      isActive: true,
    },
  };
  if (state) {
    recommendationFilter.Pharmacy.state = { equals: state, mode: 'insensitive' };
  }
  if (lga) {
    recommendationFilter.Pharmacy.lga = { equals: lga, mode: 'insensitive' };
  }
  if (ward) {
    recommendationFilter.Pharmacy.ward = { equals: ward, mode: 'insensitive' };
  }
  if (hasValidCoordinates) {
    recommendationFilter.Pharmacy.id = {
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
        select: { dayOfWeek: true, openTime: true, closeTime: true },
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
      Medication: { select: { id: true, brandName: true } },
    },
  });

  return grouped.map(group => {
    const pharmacy = pharmacies.find(p => p.id === group.pharmacyId);
    if (!pharmacy) return null;

    const meds = availabilityDetails
      .filter(ad => ad.pharmacyId === group.pharmacyId)
      .map(ad => {
        // find the main medication object to get displayName
        const mainMed = medications.find(m => m.id === ad.medicationId);
        return {
          id: ad.medicationId,
          brandName: ad.Medication.brandName,
          displayName: mainMed?.displayName || ad.Medication.brandName, // ✅ merge displayName here
          price: ad.price,
        };
      });

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
      email: prescription.email,
      phone: prescription.phone,
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
        PrescriptionMedication: {
          include: {
            Medication: {
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

    const coveredMedicationIds = prescription.PrescriptionMedication
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

module.exports = { uploadPrescription, addMedications, verifyPrescription, retrievePrescription, getPrescriptionOrder, getPrescriptionStatuses, validatePrescriptionExpiry, calculateExpiryDate, EXPIRY_PERIODS };