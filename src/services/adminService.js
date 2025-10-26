const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { capitalize, formatPerUnitType, formatPackSizeUnit, formatStrengthUnit, resolveManufacturer, computePackSizeQuantity, linkIngredients } = require('../utils/medicationUtils')



async function getDashboardOverview() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Fetch all counts, recent items, and metrics in a single transaction
  const [
    // Core counts
    pharmacyCount,
    medicationCount,
    prescriptionCount,
    userCount,
    pendingPrescriptions,
    verifiedPharmaciesCount,
    orderCount,

    // Recent items
    recentOrders,
    recentPrescriptions,

    // Drug classification counts
    anatomicalClassCount,
    therapeuticClassCount,
    pharmacologicalClassCount,
    chemicalClassCount,
    chemicalSubstanceCount,
    genericNameCount,
    activeSubstanceCount,
    manufacturerCount,
    indicationCount,

    // Growth metrics (last 30 days)
    newUsersLast30Days,
    newPharmaciesLast30Days,
    ordersLast30Days,
    ordersLast7Days,

    // Previous period metrics (30–60 days ago)
    newUsersLast60To30Days,
    newPharmaciesLast60To30Days,
    ordersLast60To30Days,

    // Status breakdowns
    prescriptionsByStatus,
    ordersByStatus,
    pharmaciesByStatus,

    // High priority items
    unverifiedPharmacies,

    // Revenue
    totalRevenueLast30Days,
    totalRevenueLast7Days
  ] = await prisma.$transaction([
    // === Core counts ===
    prisma.pharmacy.count(),
    prisma.medication.count(),
    prisma.prescription.count(),
    prisma.adminUser.count(),
    prisma.prescription.count({ where: { status: 'PENDING' } }),
    prisma.pharmacy.count({ where: { status: 'VERIFIED' } }),
    prisma.order.count(),

    // === Recent items ===
    prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        trackingCode: true,
        userIdentifier: true,
        totalPrice: true,
        status: true,
        createdAt: true,
        OrderItem: {
          select: {
            quantity: true,
            MedicationAvailability: {
              select: {
                Medication: { select: { brandName: true } }
              }
            }
          }
        }
      }
    }),
    prisma.prescription.findMany({
      take: 5,
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, createdAt: true, userIdentifier: true }
    }),

    // === Drug classification counts ===
    prisma.anatomicalClass.count(),
    prisma.therapeuticClass.count(),
    prisma.pharmacologicalClass.count(),
    prisma.chemicalClass.count(),
    prisma.chemicalSubstance.count(),
    prisma.genericName.count(),
    prisma.activeSubstance.count(),
    prisma.manufacturer.count(),
    prisma.indication.count(),

    // === Growth metrics ===
    prisma.adminUser.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.pharmacy.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.order.count({ where: { createdAt: { gte: sevenDaysAgo } } }),

    // === Previous period metrics (30–60 days ago) ===
    prisma.adminUser.count({
      where: { createdAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), lt: thirtyDaysAgo } }
    }),
    prisma.pharmacy.count({
      where: { createdAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), lt: thirtyDaysAgo } }
    }),
    prisma.order.count({
      where: { createdAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), lt: thirtyDaysAgo } }
    }),

    // === Status breakdowns ===
    prisma.prescription.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.pharmacy.groupBy({ by: ['status'], _count: { status: true } }),

    // === High priority items ===
    prisma.pharmacy.count({ where: { status: 'PENDING' } }),

    // === Revenue ===
    prisma.order.aggregate({
      where: { createdAt: { gte: thirtyDaysAgo }, status: 'COMPLETED' },
      _sum: { totalPrice: true }
    }),
    prisma.order.aggregate({
      where: { createdAt: { gte: sevenDaysAgo }, status: 'COMPLETED' },
      _sum: { totalPrice: true }
    })
  ]);

  // === Safe growth calculation function ===
  const calcGrowth = (recent, previous) =>
    previous > 0 ? ((recent - previous) / previous * 100).toFixed(1) : recent > 0 ? 100 : 0;

  const userGrowthRate = calcGrowth(newUsersLast30Days, newUsersLast60To30Days);
  const pharmacyGrowthRate = calcGrowth(newPharmaciesLast30Days, newPharmaciesLast60To30Days);
  const orderGrowthRate = calcGrowth(ordersLast30Days, ordersLast60To30Days);

  // === Safe status mapping function ===
  const mapStatus = (arr) =>
    arr?.reduce((acc, item) => {
      acc[item.status?.toLowerCase()] = item._count?.status || 0;
      return acc;
    }, {}) || {};

  // === Assemble dashboard summary ===
  const summary = {
    pharmacies: {
      total: pharmacyCount,
      verified: verifiedPharmaciesCount,
      unverified: unverifiedPharmacies || 0,
      growthRate: parseFloat(pharmacyGrowthRate),
      new30Days: newPharmaciesLast30Days,
      statusBreakdown: mapStatus(pharmaciesByStatus)
    },
    medications: {
      total: medicationCount,
    },
    prescriptions: {
      total: prescriptionCount,
      pending: pendingPrescriptions || 0,
      recent: recentPrescriptions || [],
      statusBreakdown: mapStatus(prescriptionsByStatus)
    },
    users: {
      total: userCount,
      growthRate: parseFloat(userGrowthRate),
      new30Days: newUsersLast30Days
    },
    orders: {
      total: orderCount,
      recent: recentOrders || [],
      last30Days: ordersLast30Days,
      last7Days: ordersLast7Days,
      growthRate: parseFloat(orderGrowthRate),
      statusBreakdown: mapStatus(ordersByStatus)
    },
    revenue: {
      last30Days: totalRevenueLast30Days?._sum?.totalPrice || 0,
      last7Days: totalRevenueLast7Days?._sum?.totalPrice || 0
    },
    drugClassifications: {
      anatomicalClasses: { total: anatomicalClassCount },
      therapeuticClasses: { total: therapeuticClassCount },
      pharmacologicalClasses: { total: pharmacologicalClassCount },
      chemicalClasses: { total: chemicalClassCount },
      chemicalSubstances: { total: chemicalSubstanceCount },
      genericNames: { total: genericNameCount },
      activeSubstances: { total: activeSubstanceCount }
    },
    manufacturers: { total: manufacturerCount },
    indications: { total: indicationCount },
    alerts: {
      pendingPrescriptions,
      unverifiedPharmacies: unverifiedPharmacies || 0,
      pendingOrders: mapStatus(ordersByStatus).confirmed || 0
    },
    systemHealth: {
      totalActiveEntities: verifiedPharmaciesCount + medicationCount,
      processingLoad: pendingPrescriptions,
      verificationRate: pharmacyCount > 0 ? (verifiedPharmaciesCount / pharmacyCount * 100).toFixed(1) : 0
    }
  };

  console.log('Enhanced dashboard summary:', summary);
  return summary;
}


async function getPharmacies({ page = 1, limit = 10, status, state, name }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status && status !== "all") where.status = status.toUpperCase();
  if (state) where.state = state;
  if (name) where.name = { contains: name, mode: "insensitive" };

  const [pharmacies, total] = await prisma.$transaction([
    prisma.pharmacy.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        lga: true,
        state: true,
        phone: true,
        licenseNumber: true,
        status: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        verifiedAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.pharmacy.count({ where }),
  ]);

  return {
    pharmacies,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

async function getSimplePharmacies() {
  const simplePharmacies = await prisma.pharmacy.findMany({
    select: {
      id: true,
      name: true,
    },
  });
  console.log('Pharmacies fetched for filter:', { count: simplePharmacies.length });
  return simplePharmacies;
}

async function getPharmacy(id) {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      lga: true,
      state: true,
      phone: true,
      licenseNumber: true,
      status: true,
      logoUrl: true,
      isActive: true,
      createdAt: true,
      verifiedAt: true,
    },
  });
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }
  console.log('Pharmacy fetched:', { pharmacyId: id });
  return pharmacy;
}

async function updatePharmacy(id, data) {
  // 1️⃣ Check if pharmacy exists
  const existingPharmacy = await prisma.pharmacy.findUnique({ where: { id } });
  if (!existingPharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }

  // 2️⃣ Check for license number conflict
  if (
    data.licenseNumber &&
    data.licenseNumber !== existingPharmacy.licenseNumber
  ) {
    const licenseConflict = await prisma.pharmacy.findUnique({
      where: { licenseNumber: data.licenseNumber },
    });
    if (licenseConflict) {
      const error = new Error('License number already exists');
      error.status = 400;
      throw error;
    }
  }

  // 3️⃣ Build update payload
  const updateData = {
    name: data.name,
    address: data.address,
    lga: data.lga,
    state: data.state,
    phone: data.phone,
    licenseNumber: data.licenseNumber,
    status: data.status,
    logoUrl: data.logoUrl,
    isActive: data.isActive,
    verifiedAt:
      data.status === 'VERIFIED'
        ? new Date()
        : data.status === 'REJECTED'
        ? null
        : existingPharmacy.verifiedAt,
  };

  // Include lat/long if provided
  if (typeof data.lat === 'number' && typeof data.long === 'number') {
    updateData.lat = data.lat;
    updateData.long = data.long;
  }

  // 4️⃣ Run atomic transaction
  const updatedPharmacy = await prisma.$transaction(async (tx) => {
    const pharmacy = await tx.pharmacy.update({
      where: { id },
      data: updateData,
    });

    // If coordinates provided, also sync PostGIS location
    if (typeof data.lat === 'number' && typeof data.long === 'number') {
      await tx.$executeRaw`
        UPDATE "Pharmacy"
        SET location = ST_SetSRID(ST_MakePoint(${data.long}, ${data.lat}), 4326)
        WHERE id = ${id}
      `;
    }

    return pharmacy;
  });

  // 5️⃣ Return formatted response
  console.log('Pharmacy updated:', { pharmacyId: id });
  return {
    id: updatedPharmacy.id,
    name: updatedPharmacy.name,
    address: updatedPharmacy.address,
    lga: updatedPharmacy.lga,
    state: updatedPharmacy.state,
    phone: updatedPharmacy.phone,
    licenseNumber: updatedPharmacy.licenseNumber,
    status: updatedPharmacy.status,
    logoUrl: updatedPharmacy.logoUrl,
    isActive: updatedPharmacy.isActive,
    lat: updatedPharmacy.lat,
    long: updatedPharmacy.long,
    createdAt: updatedPharmacy.createdAt,
    verifiedAt: updatedPharmacy.verifiedAt,
  };
}



async function deletePharmacy(id) {
  const existingPharmacy = await prisma.pharmacy.findUnique({
    where: { id },
  });
  if (!existingPharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }
  await prisma.pharmacy.delete({
    where: { id },
  });
  console.log('Pharmacy deleted:', { pharmacyId: id });
}


// getMedications function 
async function getMedications({ 
  page = 1, 
  limit = 10, 
  brandName, 
  activeSubstance, 
  prescriptionRequired, 
  pharmacyId,
  manufacturerId,
  form, 
  nafdacStatus 
}) {
  const skip = (page - 1) * limit;

  const where = {};
  
  // Parameter mapping
  if (prescriptionRequired !== undefined) {
    where.prescriptionRequired = prescriptionRequired;
  }
  if (brandName) where.brandName = { contains: brandName, mode: 'insensitive' };
  if (manufacturerId) where.manufacturerId = manufacturerId;
  if (form) where.form = form;
  if (nafdacStatus) where.nafdacStatus = nafdacStatus;
  
  // Pharmacy filter
  if (pharmacyId) {
    where.availabilities = { some: { pharmacyId } };
  }
  
  // Fixed active substance filter
  if (activeSubstance) {
    where.Medication_MedicationIngredient = {
      some: { 
        MedicationIngredient: { 
          ActiveSubstance: { 
            name: { contains: activeSubstance, mode: 'insensitive' } 
          } 
        } 
      }
    };
  }

  try {
    const [medications, total] = await prisma.$transaction([
      prisma.medication.findMany({
        where,
        select: {
          id: true,
          brandName: true,
          brandDescription: true,
          localNames: true, 
          fullName: true, 
          Manufacturer: { select: { id: true, name: true } },
          pharmacopeia: true,
          form: true,
          route: true,
          packSizeExpression: true,
          packSizeQuantity: true,
          packSizeUnit: true,
          nafdacCode: true,
          nafdacStatus: true,
          prescriptionRequired: true,
          regulatoryClass: true,
          restrictedTo: true,
          insuranceCoverage: true,
          imageUrl: true,
          createdAt: true,
          approvalDate: true,
          expiryDate: true,
          storageConditions: true,
          Medication_MedicationIngredient: {
            select: {
              MedicationIngredient: {
                select: {
                  id: true,
                  strengthValue: true,
                  strengthUnit: true,
                  perUnitValue: true,
                  perUnitType: true,
                  ActiveSubstance: { 
                    select: { id: true, name: true } 
                  }
                }
              }
            }
          },
          MedicationAvailability: {
            select: {
              stock: true,
              price: true,
              Pharmacy: { select: { id: true, name: true } },
            },
          },
        },
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' } // Added ordering
      }),
      prisma.medication.count({ where }),
    ]);

    // Improved ingredient mapping
    const medsWithIngredients = medications.map(med => ({
      ...med,
      form: capitalize(med.form),
      packSizeUnit: formatPackSizeUnit(med.packSizeUnit),
      ingredients: med.Medication_MedicationIngredient.map(mmi => ({
        id: mmi.MedicationIngredient.id,
        activeSubstanceId: mmi.MedicationIngredient.ActiveSubstance?.id || null,
        activeSubstanceName: mmi.MedicationIngredient.ActiveSubstance?.name || null,
        strengthValue: mmi.MedicationIngredient.strengthValue,
        strengthUnit: formatStrengthUnit(mmi.MedicationIngredient.strengthUnit),
        perUnitValue: mmi.MedicationIngredient.perUnitValue,
        perUnitType: formatPerUnitType(mmi.MedicationIngredient.perUnitType),
      }))
    }));

    console.log('Medications fetched:', { count: medications.length, total, filters: where });

    return {
      medications: medsWithIngredients,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  } catch (error) {
    console.error('Error fetching medications:', error);
    throw new Error('Failed to fetch medications');
  }
}

// Fixed getMedication function
async function getMedication(id) {
  try {
    const medication = await prisma.medication.findUnique({
      where: { id },
      select: {
        id: true,
        brandName: true,
        brandDescription: true,
        localNames: true,
        fullName: true,
        manufacturerId: true,
        Manufacturer: { select: { id: true, name: true } },
        pharmacopeia: true,
        form: true,
        route: true,
        packSizeExpression: true,
        packSizeQuantity: true,
        packSizeUnit: true,
        nafdacCode: true,
        nafdacStatus: true,
        prescriptionRequired: true,
        regulatoryClass: true,
        restrictedTo: true,
        insuranceCoverage: true,
        imageUrl: true,
        createdAt: true,
        approvalDate: true,
        expiryDate: true,
        storageConditions: true,
        Medication_MedicationIngredient: {
          select: {
            MedicationIngredient: {
              select: {
                id: true,
                strengthValue: true,
                strengthUnit: true,
                perUnitValue: true,
                perUnitType: true,
                ActiveSubstance: { 
                  select: { id: true, name: true } 
                }
              }
            }
          }
        },
        MedicationAvailability: {
          select: {
            stock: true,
            price: true,
            Pharmacy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!medication) {
      const error = new Error('Medication not found');
      error.status = 404;
      throw error;
    }

    const medicationWithIngredients = {
      ...medication,
      ingredients: medication.Medication_MedicationIngredient.map(mmi => ({
        id: mmi.MedicationIngredient.id,
        activeSubstanceId: mmi.MedicationIngredient.ActiveSubstance?.id || null,
        activeSubstanceName: mmi.MedicationIngredient.ActiveSubstance?.name || null,
        strengthValue: mmi.MedicationIngredient.strengthValue,
        strengthUnit: mmi.MedicationIngredient.strengthUnit,
        perUnitValue: mmi.MedicationIngredient.perUnitValue,
        perUnitType: mmi.MedicationIngredient.perUnitType,
      }))
    };

    console.log('Medication fetched:', { medicationId: id });
    return medicationWithIngredients;
  } catch (error) {
    console.error('Error fetching medication:', error);
    throw error;
  }
}


// CREATE MEDICATION --

async function createMedication(data) {
  try {
    console.log('Received data:', JSON.stringify(data, null, 2));

    // 1️⃣ Validate ingredients before starting the transaction
    if (!data.ingredients || !Array.isArray(data.ingredients) || data.ingredients.length === 0) {
      throw new Error('At least one active substance is required');
    }

    const activeSubstanceIds = data.ingredients.map(i => i.activeSubstanceId);
    const activeSubstances = await prisma.activeSubstance.findMany({ where: { id: { in: activeSubstanceIds } } });
    if (activeSubstances.length !== activeSubstanceIds.length) {
      throw new Error('One or more active substances not found');
    }

    // 2️⃣ Check for duplicate NAFDAC code
    const existingMed = await prisma.medication.findUnique({ where: { nafdacCode: data.nafdacCode } });
    if (existingMed) throw new Error('NAFDAC code already exists');

    // 3️⃣ Run everything inside a single transaction
    const medication = await prisma.$transaction(async (tx) => {
      // Resolve manufacturer ID (existing or newly created)
      const manufacturerId = await resolveManufacturer(tx, data);

      // Compute pack size quantity from expression like "10 x 10"
      const computedQty = computePackSizeQuantity(data.packSizeExpression);

      // Create medication record
      const med = await tx.medication.create({
        data: {
          brandName: data.brandName,
          nafdacCode: data.nafdacCode,
          prescriptionRequired: data.prescriptionRequired ?? false,
          brandDescription: data.brandDescription || null,
          manufacturerId,
          pharmacopeia: data.pharmacopeia || null,
          form: data.form || null,
          packSizeExpression: data.packSizeExpression || null,
          packSizeQuantity: computedQty,
          packSizeUnit: data.packSizeUnit || null,
          imageUrl: data.imageUrl || null,
        },
      });

      // Link ingredients to this medication
      await linkIngredients(tx, med.id, data.ingredients);

      return med;
    });

    console.log('Medication created:', { medicationId: medication.id });
    return medication;

  } catch (error) {
    console.error('Error creating medication:', error);
    throw error;
  }
}


// UPDATE MEDICATION --

async function updateMedication(id, data) {
  try {
    console.log('Update data received:', JSON.stringify(data, null, 2));

    const medication = await prisma.medication.findUnique({ where: { id } });
    if (!medication) throw Object.assign(new Error('Medication not found'), { status: 404 });

    // Check NAFDAC code uniqueness if being updated
    if (data.nafdacCode && data.nafdacCode !== medication.nafdacCode) {
      const existingMed = await prisma.medication.findUnique({ where: { nafdacCode: data.nafdacCode } });
      if (existingMed) throw new Error('NAFDAC code already exists');
    }

    return await prisma.$transaction(async (tx) => {
      const updateData = {};

      // Update basic fields if provided
      if (data.brandName !== undefined) updateData.brandName = data.brandName;
      if (data.brandDescription !== undefined) updateData.brandDescription = data.brandDescription;

      // Manufacturer handling
      if (data.manufacturerId !== undefined) {
        const manufacturer = await tx.manufacturer.findUnique({ where: { id: data.manufacturerId } });
        if (!manufacturer) throw new Error('Manufacturer not found');
        updateData.manufacturerId = data.manufacturerId;
      } else if (data.manufacturerName) {
        const manufacturerId = await resolveManufacturer(tx, data);
        updateData.manufacturerId = manufacturerId;
      }

      if (data.form !== undefined) updateData.form = data.form;

      // Update pack size expression and quantity
      if (data.packSizeExpression !== undefined) {
        updateData.packSizeExpression = data.packSizeExpression;
        updateData.packSizeQuantity = computePackSizeQuantity(data.packSizeExpression);
      }

      if (data.packSizeUnit !== undefined) updateData.packSizeUnit = data.packSizeUnit;
      if (data.pharmacopeia !== undefined) updateData.pharmacopeia = data.pharmacopeia;
      if (data.nafdacCode !== undefined) updateData.nafdacCode = data.nafdacCode;
      if (data.prescriptionRequired !== undefined) updateData.prescriptionRequired = !!data.prescriptionRequired;
      if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
      if (data.fullName !== undefined) updateData.fullName = data.fullName;

      // Apply updates to medication
      const updatedMedication = await tx.medication.update({ where: { id }, data: updateData });

      // Update ingredients if provided
      if (Array.isArray(data.ingredients)) {
        await linkIngredients(tx, id, data.ingredients, true); // true = remove orphaned ingredients
      }

      return updatedMedication;
    });

  } catch (error) {
    console.error('Error updating medication:', error);
    throw error;
  }
}


async function deleteMedication(id) {
  try {
    await prisma.$transaction(async (prisma) => {
      await prisma.orderItem.deleteMany({
        where: { medicationId: id },
      });
      await prisma.medicationAvailability.deleteMany({
        where: { medicationId: id },
      });
      await prisma.medication.delete({
        where: { id },
      });
    });
    console.log('Medication, related MedicationAvailability, and OrderItem records deleted:', { medicationId: id });
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Medication not found');
      err.status = 404;
      throw err;
    }
    throw error;
  }
}


async function getPrescriptions({ page, limit, status, userIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  
  if (status) where.status = status.toUpperCase();
  if (userIdentifier) {
    where.userIdentifier = { contains: userIdentifier, mode: 'insensitive' };
  }

  const [prescriptions, total] = await prisma.$transaction([
    prisma.prescription.findMany({
      where,
      select: {
        id: true,
        userIdentifier: true,
        fileUrl: true,
        status: true,
        createdAt: true,
        Order: {
          select: {
            id: true,
            trackingCode: true,
            status: true,
            Pharmacy: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // 👈 newest first
      },
      take: limit,
      skip,
    }),
    prisma.prescription.count({ where }),
  ]);

  console.log('Prescriptions fetched:', { count: prescriptions.length, total });

  return {
    prescriptions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getPrescription(id) {
  const prescription = await prisma.prescription.findUnique({
    where: { id },
    include: {
      PrescriptionMedication: {
        include: { Medication: true },
      },
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
    const error = new Error('Prescription not found');
    error.status = 404;
    throw error;
  }
  console.log('Prescription fetched:', { prescriptionId: id });
  return prescription;
}


async function getOrders({ page, limit, status, userIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};

  if (status) where.status = status.toUpperCase();
  if (userIdentifier) {
    where.userIdentifier = { contains: userIdentifier, mode: 'insensitive' };
  }

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        userIdentifier: true,
        status: true,
        totalPrice: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc', // 👈 newest first
      },
      take: limit,
      skip,
    }),
    prisma.order.count({ where }),
  ]);

  console.log('Orders fetched:', { count: orders.length, total });

  return {
    orders,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getOrder(id) {
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      userIdentifier: true,
      status: true,
      totalPrice: true,
      deliveryMethod: true,
      address: true,
      email: true,
      phone: true,
      trackingCode: true,
      filledAt: true,
      cancelledAt: true,
      cancelReason: true,
      paymentReference: true,
      paymentStatus: true,
      createdAt: true,
      updatedAt: true,
      Pharmacy: {
        select: { id: true, name: true },
      },
      Prescription: {
        select: {
          id: true,
          userIdentifier: true,
          status: true,
          fileUrl: true,
        },
      },
      OrderItem: {
        select: {
          MedicationAvailability: {
            select: {
              Medication: {
                select: {
                  id: true,
                  brandName: true,
                  // Pull active ingredients via join table
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: {
                          id: true,
                          strengthValue: true,
                          strengthUnit: true,
                          perUnitValue: true,
                          perUnitType: true,
                          ActiveSubstance: {
                            select: { id: true, name: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
              Pharmacy: {
                select: { id: true, name: true },
              },
            },
          },
          quantity: true,
          price: true,
        },
      },
    },
  });

  if (!order) {
    const error = new Error('Order not found');
    error.status = 404;
    throw error;
  }

  console.log('Order fetched:', { orderId: id });
  return order;
}


async function getAdminUsers({ page, limit, role, email }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (role) where.role = role;
  if (email) where.email = { contains: email, mode: 'insensitive' };
  const [users, total] = await prisma.$transaction([
    prisma.adminUser.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.adminUser.count({ where }),
  ]);
  console.log('Admin users fetched:', { count: users.length, total });
  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getAdminUser(id) {
  const user = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });
  if (!user) {
    const error = new Error('Admin user not found');
    error.status = 404;
    throw error;
  }
  console.log('Admin user fetched:', { userId: id });
  return user;
}

async function getPharmacyUsers({ page, limit, role, email, pharmacyId }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (role) where.role = role;
  if (email) where.email = { contains: email, mode: 'insensitive' };
  if (pharmacyId) where.pharmacyId = pharmacyId;
  const [users, total] = await prisma.$transaction([
    prisma.pharmacyUser.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        pharmacy: {
          select: { id: true, name: true },
        },
      },
      take: limit,
      skip,
    }),
    prisma.pharmacyUser.count({ where }),
  ]);
  console.log('Pharmacy users fetched:', { count: users.length, total });
  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getPharmacyUser(id) {
  const user = await prisma.pharmacyUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastLogin: true,
      pharmacy: {
        select: { id: true, name: true },
      },
    },
  });
  if (!user) {
    const error = new Error('Pharmacy user not found');
    error.status = 404;
    throw error;
  }
  console.log('Pharmacy user fetched:', { userId: id });
  return user;
}




// ==================== ANATOMICAL CLASS SERVICES ====================
async function getAnatomicalClasses({ page = 1, limit = 20, name }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = name ? { name: { contains: name, mode: 'insensitive' } } : {};
  
  const [anatomicalClasses, total] = await prisma.$transaction([
    prisma.anatomicalClass.findMany({ 
      where, 
      take, 
      skip,
      orderBy: { name: 'asc' }
    }),
    prisma.anatomicalClass.count({ where }),
  ]);
  
  return { 
    anatomicalClasses, 
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) } 
  };
}

async function getAnatomicalClass(id) {
  const anatomicalClass = await prisma.anatomicalClass.findUnique({ 
    where: { id },
    include: {
      TherapeuticClass: {
        select: { id: true, name: true, atcCode: true }
      }
    }
  });
  if (!anatomicalClass) { 
    const error = new Error('Anatomical class not found'); 
    error.status = 404; 
    throw error; 
  }
  return anatomicalClass;
}

async function createAnatomicalClass(data) {
  try {
    return await prisma.anatomicalClass.create({ data });
  } catch (error) {
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function updateAnatomicalClass(id, data) {
  try {
    return await prisma.anatomicalClass.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Anatomical class not found'); 
      err.status = 404; 
      throw err; 
    }
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function deleteAnatomicalClass(id) {
  try {
    await prisma.anatomicalClass.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Anatomical class not found'); 
      err.status = 404; 
      throw err; 
    }
    throw error;
  }
}

async function getTherapeuticClassesByAnatomical(anatomicalId) {
  const children = await prisma.therapeuticClass.findMany({
    where: { parentId: anatomicalId },
    orderBy: { name: 'asc' }
  });
  return children;
}

// ==================== THERAPEUTIC CLASS SERVICES ====================
async function getTherapeuticClasses({ page = 1, limit = 20, name, parentId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (parentId) where.parentId = Number(parentId); // filter by anatomical class

  const [therapeuticClasses, total] = await prisma.$transaction([
    prisma.therapeuticClass.findMany({
      where,
      take,
      skip,
      include: {
        AnatomicalClass: { select: { id: true, name: true, atcCode: true } }
      },
      orderBy: { name: 'asc' }
    }),
    prisma.therapeuticClass.count({ where }),
  ]);

  return {
    therapeuticClasses,
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) }
  };
}

// Get single therapeutic class by ID
async function getTherapeuticClass(id) {
  const therapeuticClass = await prisma.therapeuticClass.findUnique({
    where: { id },
    include: {
      AnatomicalClass: { select: { id: true, name: true, atcCode: true } },
      PharmacologicalClass: { select: { id: true, name: true, atcCode: true } }
    }
  });
  if (!therapeuticClass) {
    const error = new Error('Therapeutic class not found');
    error.status = 404;
    throw error;
  }
  return therapeuticClass;
}

// Create therapeutic class
async function createTherapeuticClass(data) {
  try {
    return await prisma.therapeuticClass.create({ data });
  } catch (error) {
    if (error.code === 'P2002') { // unique constraint
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    if (error.code === 'P2003') { // invalid foreign key
      const err = new Error('Invalid parent anatomical class');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

// Update therapeutic class
async function updateTherapeuticClass(id, data) {
  try {
    return await prisma.therapeuticClass.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Therapeutic class not found');
      err.status = 404;
      throw err;
    }
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error('Invalid parent anatomical class');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

// Delete therapeutic class
async function deleteTherapeuticClass(id) {
  try {
    await prisma.therapeuticClass.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Therapeutic class not found');
      err.status = 404;
      throw err;
    }
    throw error;
  }
}

// Get pharmacological classes by therapeutic class
async function getPharmacologicalClassesByTherapeutic(therapeuticId) {
  const children = await prisma.pharmacologicalClass.findMany({
    where: { parentId: therapeuticId },
    orderBy: { name: 'asc' }
  });
  return children;
}


// ==================== PHARMACOLOGICAL CLASS SERVICES ====================
async function getPharmacologicalClasses({ page = 1, limit = 20, name, parentId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (parentId) where.parentId = Number(parentId);
  
  const [pharmacologicalClasses, total] = await prisma.$transaction([
    prisma.pharmacologicalClass.findMany({ 
      where, 
      take, 
      skip,
      include: {
        TherapeuticClass: {
          select: { id: true, name: true, atcCode: true }
        }
      },
      orderBy: { name: 'asc' }
    }),
    prisma.pharmacologicalClass.count({ where }),
  ]);
  
  return { 
    pharmacologicalClasses, 
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) } 
  };
}

async function getPharmacologicalClass(id) {
  const pharmacologicalClass = await prisma.pharmacologicalClass.findUnique({ 
    where: { id },
    include: {
      TherapeuticClass: {
        select: { id: true, name: true, atcCode: true }
      },
      ChemicalClass: {
        select: { id: true, name: true, atcCode: true }
      }
    }
  });
  if (!pharmacologicalClass) { 
    const error = new Error('Pharmacological class not found'); 
    error.status = 404; 
    throw error; 
  }
  return pharmacologicalClass;
}

async function createPharmacologicalClass(data) {
  try {
    return await prisma.pharmacologicalClass.create({ data });
  } catch (error) {
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error('Invalid parent therapeutic class');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function updatePharmacologicalClass(id, data) {
  try {
    return await prisma.pharmacologicalClass.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Pharmacological class not found'); 
      err.status = 404; 
      throw err; 
    }
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function deletePharmacologicalClass(id) {
  try {
    await prisma.pharmacologicalClass.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Pharmacological class not found'); 
      err.status = 404; 
      throw err; 
    }
    throw error;
  }
}

async function getPharmacologicalClassesByTherapeutic(therapeuticId) {
  const children = await prisma.pharmacologicalClass.findMany({
    where: { parentId: therapeuticId },
    orderBy: { name: 'asc' }
  });
  return children;
}

async function getChemicalClassesByPharmacological(pharmacologicalId) {
  const children = await prisma.chemicalClass.findMany({
    where: { parentId: pharmacologicalId },
    orderBy: { name: 'asc' }
  });
  return children;
}


// ==================== CHEMICAL CLASS SERVICES ====================
async function getChemicalClasses({ page = 1, limit = 20, name, parentId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  if (name) where.name = { contains: name, mode: "insensitive" };
  if (parentId) where.parentId = Number(parentId);

  const [chemicalClasses, total] = await prisma.$transaction([
    prisma.chemicalClass.findMany({
      where,
      take,
      skip,
      include: {
        PharmacologicalClass: { select: { id: true, name: true, atcCode: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.chemicalClass.count({ where }),
  ]);

  return {
    chemicalClasses,
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) },
  };
}

// Get single chemical class by ID
async function getChemicalClass(id) {
  const chemicalClass = await prisma.chemicalClass.findUnique({
    where: { id },
    include: {
      PharmacologicalClass: { select: { id: true, name: true, atcCode: true } },
      ChemicalSubstance: { select: { id: true, name: true, atcCode: true } },
    },
  });
  if (!chemicalClass) {
    const error = new Error("Chemical class not found");
    error.status = 404;
    throw error;
  }
  return chemicalClass;
}

// Create a chemical class
async function createChemicalClass(data) {
  try {
    return await prisma.chemicalClass.create({ data });
  } catch (error) {
    if (error.code === "P2002") { // unique constraint (ATC)
      const err = new Error("ATC code already exists");
      err.status = 400;
      throw err;
    }
    if (error.code === "P2003") { // invalid foreign key
      const err = new Error("Invalid parent pharmacological class");
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

// Update a chemical class
async function updateChemicalClass(id, data) {
  try {
    return await prisma.chemicalClass.update({ where: { id }, data });
  } catch (error) {
    if (error.code === "P2025") {
      const err = new Error("Chemical class not found");
      err.status = 404;
      throw err;
    }
    if (error.code === "P2002") {
      const err = new Error("ATC code already exists");
      err.status = 400;
      throw err;
    }
    if (error.code === "P2003") {
      const err = new Error("Invalid parent pharmacological class");
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

// Delete a chemical class
async function deleteChemicalClass(id) {
  try {
    await prisma.chemicalClass.delete({ where: { id } });
  } catch (error) {
    if (error.code === "P2025") {
      const err = new Error("Chemical class not found");
      err.status = 404;
      throw err;
    }
    throw error;
  }
}

// Get chemical substances by chemical class
async function getChemicalSubstancesByChemical(chemicalClassId) {
  const children = await prisma.chemicalSubstance.findMany({
    where: { parentId: chemicalClassId },
    orderBy: { name: 'asc' },
  });
  return children;
}


// ==================== CHEMICAL SUBSTANCE SERVICES ====================
async function getChemicalSubstances({ page = 1, limit = 20, name, parentId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (parentId) where.parentId = Number(parentId);
  
  const [chemicalSubstances, total] = await prisma.$transaction([
    prisma.chemicalSubstance.findMany({ 
      where, 
      take, 
      skip,
      include: {
        ChemicalClass: {
          select: { id: true, name: true, atcCode: true }
        }
      },
      orderBy: { name: 'asc' }
    }),
    prisma.chemicalSubstance.count({ where }),
  ]);
  
  return { 
    chemicalSubstances, 
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) } 
  };
}

async function getChemicalSubstance(id) {
  const chemicalSubstance = await prisma.chemicalSubstance.findUnique({ 
    where: { id },
    include: {
      ChemicalClass: {
        select: { id: true, name: true, atcCode: true }
      }
    }
  });
  if (!chemicalSubstance) { 
    const error = new Error('Chemical substance not found'); 
    error.status = 404; 
    throw error; 
  }
  return chemicalSubstance;
}

async function createChemicalSubstance(data) {
  try {
    return await prisma.chemicalSubstance.create({ data });
  } catch (error) {
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error('Invalid parent chemical class');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function updateChemicalSubstance(id, data) {
  try {
    return await prisma.chemicalSubstance.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Chemical substance not found'); 
      err.status = 404; 
      throw err; 
    }
    if (error.code === 'P2002') {
      const err = new Error('ATC code already exists');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function deleteChemicalSubstance(id) {
  try {
    await prisma.chemicalSubstance.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Chemical substance not found'); 
      err.status = 404; 
      throw err; 
    }
    throw error;
  }
}


// ==================== GENERIC NAME SERVICES ====================
async function getGenericNames({ page = 1, limit = 20, name }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};

  if (name) where.name = { contains: name, mode: 'insensitive' };

  const [genericNames, total] = await prisma.$transaction([
    prisma.genericName.findMany({
      where,
      take,
      skip,
      include: {
        ActiveSubstance: {
          select: { id: true, name: true, type: true },
        },
        Indication: {
          select: { id: true, description: true }, // only existing fields
        },
        Contraindication: {
          select: { id: true, description: true }, // only existing fields
        },
        GenericNameChemicalSubstance: true, // include all fields
      },
      orderBy: { name: 'asc' },
    }),
    prisma.genericName.count({ where }),
  ]);

  return {
    genericNames,
    pagination: {
      page: Number(page),
      limit: take,
      total,
      pages: Math.ceil(total / take),
    },
  };
}



async function getGenericName(id) {
  const genericName = await prisma.genericName.findUnique({
    where: { id: Number(id) },
    include: {
      ActiveSubstance: { select: { id: true, name: true, type: true } },
      Indication: { select: { id: true, name: true, description: true } },
      Contraindication: { select: { id: true, name: true, description: true } },
      GenericNameChemicalSubstance: true,
    },
  });

  if (!genericName) {
    const error = new Error('Generic name not found');
    error.status = 404;
    throw error;
  }

  return genericName;
}


async function createGenericName(data) {
  try {
    return await prisma.genericName.create({ data });
  } catch (error) {
    // handle unique constraint violation
    if (error.code === "P2002") {
      const err = new Error("Generic name must be unique");
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function updateGenericName(id, data) {
  try {
    return await prisma.genericName.update({ where: { id }, data });
  } catch (error) {
    if (error.code === "P2025") {
      const err = new Error("Generic name not found");
      err.status = 404;
      throw err;
    }
    if (error.code === "P2002") {
      const err = new Error("Generic name must be unique");
      err.status = 400;
      throw err;
    }
    throw error;
  }
}


async function deleteGenericName(id) {
  try {
    await prisma.genericName.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Generic name not found'); 
      err.status = 404; 
      throw err; 
    }
    throw error;
  }
}

// ==================== ACTIVE SUBSTANCE SERVICES ====================
async function getActiveSubstances({ page = 1, limit = 20, name, type, genericId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (type) where.type = type;
  if (genericId) where.genericId = Number(genericId);
  
  const [activeSubstances, total] = await prisma.$transaction([
    prisma.activeSubstance.findMany({ 
      where, 
      take, 
      skip,
      include: {
        GenericName: {
          select: { id: true, name: true }
        }
      },
      orderBy: { name: 'asc' }
    }),
    prisma.activeSubstance.count({ where }),
  ]);
  
  return { 
    activeSubstances, 
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) } 
  };
}

async function getActiveSubstance(id) {
  const activeSubstance = await prisma.activeSubstance.findUnique({ 
    where: { id },
    include: {
      GenericName: {
        select: { id: true, name: true, description: true }
      },
      MedicationIngredient: {
        select: { id: true, strengthValue: true, strengthUnit: true }
      }
    }
  });
  if (!activeSubstance) { 
    const error = new Error('Active substance not found'); 
    error.status = 404; 
    throw error; 
  }
  return activeSubstance;
}

async function createActiveSubstance(data) {
  try {
    return await prisma.activeSubstance.create({ data });
  } catch (error) {
    if (error.code === 'P2003') {
      const err = new Error('Invalid generic name ID');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function updateActiveSubstance(id, data) {
  try {
    return await prisma.activeSubstance.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Active substance not found'); 
      err.status = 404; 
      throw err; 
    }
    if (error.code === 'P2003') {
      const err = new Error('Invalid generic name ID');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function deleteActiveSubstance(id) {
  try {
    await prisma.activeSubstance.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Active substance not found'); 
      err.status = 404; 
      throw err; 
    }
    throw error;
  }
}

// ==================== MEDICATION INGREDIENT SERVICES ====================
async function getMedicationIngredients({ page = 1, limit = 20, substanceId }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = {};
  if (substanceId) where.substanceId = Number(substanceId);
  
  const [medicationIngredients, total] = await prisma.$transaction([
    prisma.medicationIngredient.findMany({ 
      where, 
      take, 
      skip,
      include: {
        ActiveSubstance: {
          select: { id: true, name: true, type: true }
        }
      },
      orderBy: { id: 'desc' }
    }),
    prisma.medicationIngredient.count({ where }),
  ]);
  
  return { 
    medicationIngredients, 
    pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) } 
  };
}

async function getMedicationIngredient(id) {
  const medicationIngredient = await prisma.medicationIngredient.findUnique({ 
    where: { id },
    include: {
      ActiveSubstance: {
        select: { id: true, name: true, type: true }
      },
      Medication_MedicationIngredient: {
        select: {
          Medication: {
            select: { id: true, brandName: true }
          }
        }
      }
    }
  });
  if (!medicationIngredient) { 
    const error = new Error('Medication ingredient not found'); 
    error.status = 404; 
    throw error; 
  }
  return medicationIngredient;
}

async function createMedicationIngredient(data) {
  try {
    return await prisma.medicationIngredient.create({ data });
  } catch (error) {
    if (error.code === 'P2002') {
      const err = new Error('Ingredient with this combination already exists');
      err.status = 400;
      throw err;
    }
    if (error.code === 'P2003') {
      const err = new Error('Invalid active substance ID');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function updateMedicationIngredient(id, data) {
  try {
    return await prisma.medicationIngredient.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Medication ingredient not found'); 
      err.status = 404; 
      throw err; 
    }
    if (error.code === 'P2002') {
      const err = new Error('Ingredient with this combination already exists');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

async function deleteMedicationIngredient(id) {
  try {
    await prisma.medicationIngredient.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { 
      const err = new Error('Medication ingredient not found'); 
      err.status = 404; 
      throw err; 
    }
    throw error;
  }
}


// MANUFACTURER SERVICES
async function getManufacturers({ page = 1, limit = 20, name }) {
  const take = Number(limit);
  const skip = (Number(page) - 1) * take;
  const where = name ? { name: { contains: name, mode: 'insensitive' } } : {};
  const [manufacturers, total] = await prisma.$transaction([
    prisma.manufacturer.findMany({ where, take, skip }),
    prisma.manufacturer.count({ where }),
  ]);
  return { manufacturers, pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) } };
}
async function getManufacturer(id) {
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id } });
  if (!manufacturer) { const error = new Error('Manufacturer not found'); error.status = 404; throw error; }
  return manufacturer;
}
async function createManufacturer(data) {
  return prisma.manufacturer.create({ data });
}
async function updateManufacturer(id, data) {
  try {
    return await prisma.manufacturer.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') { const err = new Error('Manufacturer not found'); err.status = 404; throw err; }
    throw error;
  }
}
async function deleteManufacturer(id) {
  try {
    await prisma.manufacturer.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { const err = new Error('Manufacturer not found'); err.status = 404; throw err; }
    throw error;
  }
}



// INDICATION SERVICES
async function getIndications({ page = 1, limit = 20, genericMedicationId }) {
  const skip = (page - 1) * limit;
  const where = genericMedicationId ? { genericMedicationId: Number(genericMedicationId) } : {};
  const [indications, total] = await prisma.$transaction([
    prisma.indication.findMany({ where, take: limit, skip }),
    prisma.indication.count({ where }),
  ]);
  return { indications, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
async function getIndication(id) {
  const indication = await prisma.indication.findUnique({ where: { id } });
  if (!indication) { const error = new Error('Indication not found'); error.status = 404; throw error; }
  return indication;
}
async function createIndication(data) {
  return prisma.indication.create({ data });
}
async function updateIndication(id, data) {
  try {
    return await prisma.indication.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') { const err = new Error('Indication not found'); err.status = 404; throw err; }
    throw error;
  }
}
async function deleteIndication(id) {
  try {
    await prisma.indication.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') { const err = new Error('Indication not found'); err.status = 404; throw err; }
    throw error;
  }
}



// SEARCH FILTER CODE -----

async function searchActiveSubstances({ search = '', limit = 20 }) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
  
  const activeSubstances = await prisma.activeSubstance.findMany({
    where,
    select: { id: true, name: true, type: true },
    take: limit,
    orderBy: { name: 'asc' }
  });
  
  return { activeSubstances };
}

async function searchMedicationIngredients({ search = '', limit = 20 }) {
  let substanceIds = [];
  let strengthValueFilter;

  if (search) {
    // 1️⃣ Search by ActiveSubstance name
    substanceIds = await prisma.activeSubstance.findMany({
      where: { name: { contains: search, mode: 'insensitive' } },
      select: { id: true },
      take: limit, // optional
    }).then(results => results.map(r => r.id));

    // 2️⃣ Check if the search term is a number for strengthValue
    const parsed = parseFloat(search);
    if (!isNaN(parsed)) {
      strengthValueFilter = parsed;
    }
  }

  // Build where clause
  const where = {};
  if (substanceIds.length || strengthValueFilter !== undefined) {
    where.OR = [];

    if (substanceIds.length) {
      where.OR.push({ substanceId: { in: substanceIds } });
    }

    if (strengthValueFilter !== undefined) {
      where.OR.push({ strengthValue: strengthValueFilter });
    }
  }

  const medicationIngredients = await prisma.medicationIngredient.findMany({
    where,
    select: {
      id: true,
      strengthValue: true,
      strengthUnit: true,
      perUnitValue: true,
      perUnitType: true,
      ActiveSubstance: { select: { id: true, name: true } },
    },
    take: limit,
    orderBy: { id: 'asc' }, // safer than ordering by relation name
  });

  return { medicationIngredients };
}


async function searchManufacturers({ search = '', limit = 20 }) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
  
  const manufacturers = await prisma.manufacturer.findMany({
    where,
    select: { id: true, name: true },
    take: limit,
    orderBy: { name: 'asc' }
  });
  
  return { manufacturers };
}


module.exports = {
  getDashboardOverview,
  getPharmacies,
  getSimplePharmacies,
  getPharmacy,
  updatePharmacy,
  deletePharmacy,
  getMedications,
  getMedication,
  createMedication,
  updateMedication,
  deleteMedication,
  getPrescriptions,
  getPrescription,
  getOrders,
  getOrder,
  getAdminUsers,
  getAdminUser,
  getPharmacyUsers,
  getPharmacyUser,


  // ATC Classification
  getAnatomicalClasses,
  getAnatomicalClass,
  createAnatomicalClass,
  updateAnatomicalClass,
  deleteAnatomicalClass,
  getTherapeuticClassesByAnatomical,

  getTherapeuticClasses,
  getTherapeuticClass,
  createTherapeuticClass,
  updateTherapeuticClass,
  deleteTherapeuticClass,
  
  getPharmacologicalClasses,
  getPharmacologicalClass,
  createPharmacologicalClass,
  updatePharmacologicalClass,
  deletePharmacologicalClass,
  getPharmacologicalClassesByTherapeutic,
  getChemicalClassesByPharmacological,

  getChemicalClasses,
  getChemicalClass,
  createChemicalClass,
  updateChemicalClass,
  deleteChemicalClass,
  getChemicalSubstancesByChemical,
  
  getChemicalSubstances,
  getChemicalSubstance,
  createChemicalSubstance,
  updateChemicalSubstance,
  deleteChemicalSubstance,
  
  // Generic Names
  getGenericNames,
  getGenericName,
  createGenericName,
  updateGenericName,
  deleteGenericName,
  
  // Active Substances
  getActiveSubstances,
  getActiveSubstance,
  createActiveSubstance,
  updateActiveSubstance,
  deleteActiveSubstance,
  
  // Medication Ingredients
  getMedicationIngredients,
  getMedicationIngredient,
  createMedicationIngredient,
  updateMedicationIngredient,
  deleteMedicationIngredient,


  getManufacturers,
  getManufacturer,
  createManufacturer,
  updateManufacturer,
  deleteManufacturer,
  getIndications,
  getIndication,
  createIndication,
  updateIndication,
  deleteIndication,


  searchActiveSubstances,
  searchMedicationIngredients,
  searchManufacturers,

};