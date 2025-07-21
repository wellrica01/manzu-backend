const { PrismaClient } = require('@prisma/client');
const NodeGeocoder = require('node-geocoder');
const prisma = new PrismaClient();

const geocoder = NodeGeocoder({
  provider: 'opencage',
  apiKey: process.env.OPENCAGE_API_KEY,
});

async function getDashboardOverview() {
  const [
    pharmacyCount,
    medicationCount,
    prescriptionCount,
    userCount,
    pendingPrescriptions,
    verifiedPharmaciesCount,
    orderCount,
    recentOrders
  ] = await prisma.$transaction([
    prisma.pharmacy.count(),
    prisma.medication.count(),
    prisma.prescription.count(),
    prisma.pharmacyUser.count(),
    prisma.prescription.count({ where: { status: 'PENDING' } }),
    prisma.pharmacy.count({ where: { status: 'VERIFIED' } }),
    prisma.order.count(),
    prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        trackingCode: true,
        userIdentifier: true,
        totalPrice: true,
        status: true,
        createdAt: true
      }
    })
  ]);

  const summary = {
    pharmacies: { total: pharmacyCount, verified: verifiedPharmaciesCount },
    medications: { total: medicationCount },
    prescriptions: { total: prescriptionCount, pending: pendingPrescriptions },
    users: { total: userCount },
    orders: { total: orderCount, recent: recentOrders }
  };

  console.log('Dashboard summary:', summary);
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
  const existingPharmacy = await prisma.pharmacy.findUnique({
    where: { id },
  });
  if (!existingPharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }
  if (data.licenseNumber !== existingPharmacy.licenseNumber) {
    const licenseConflict = await prisma.pharmacy.findUnique({
      where: { licenseNumber: data.licenseNumber },
    });
    if (licenseConflict) {
      const error = new Error('License number already exists');
      error.status = 400;
      throw error;
    }
  }
  const addressString = `${data.address}, ${data.lga}, ${data.state}, Nigeria`;
  const geoResult = await geocoder.geocode(addressString);
  if (!geoResult.length) {
    const error = new Error('Invalid address: unable to geocode');
    error.status = 400;
    throw error;
  }
  const { latitude, longitude } = geoResult[0];
  const updatedPharmacy = await prisma.$transaction(async (prisma) => {
    const pharmacy = await prisma.pharmacy.update({
      where: { id },
      data: {
        name: data.name,
        address: data.address,
        lga: data.lga,
        state: data.state,
        phone: data.phone,
        licenseNumber: data.licenseNumber,
        status: data.status,
        logoUrl: data.logoUrl,
        isActive: data.isActive,
        verifiedAt: data.status === 'VERIFIED' ? new Date() : data.status === 'REJECTED' ? null : existingPharmacy.verifiedAt,
      },
    });
    await prisma.$queryRaw`
      UPDATE "Pharmacy"
      SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      WHERE id = ${id}
    `;
    return pharmacy;
  });
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


async function getMedications({ page, limit, name, genericName, category, prescriptionRequired, pharmacyId }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (name) where.brandName = { contains: name, mode: 'insensitive' };
  if (genericName) where.genericMedication = { name: { contains: genericName, mode: 'insensitive' } };
  if (category) where.genericMedication = { categories: { some: { category: { name: category } } } };
  if (prescriptionRequired !== undefined) where.prescriptionRequired = prescriptionRequired;
  if (pharmacyId) where.availabilities = { some: { pharmacyId } };
  const [medications, total] = await prisma.$transaction([
    prisma.medication.findMany({
      where,
      select: {
        id: true,
        brandName: true,
        genericMedication: { select: { name: true } },
        description: true,
        manufacturer: { select: { name: true } },
        form: true,
        strengthValue: true,
        strengthUnit: true,
        nafdacCode: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        availabilities: {
          select: {
            stock: true,
            price: true,
            pharmacy: { select: { id: true, name: true } },
          },
        },
      },
      take: limit,
      skip,
    }),
    prisma.medication.count({ where }),
  ]);
  console.log('Medications fetched:', { count: medications.length, total });
  return {
    medications,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}


async function getMedication(id) {
  const medication = await prisma.medication.findUnique({
    where: { id },
    select: {
      id: true,
      brandName: true,
      genericMedication: { select: { name: true } },
      description: true,
      manufacturer: { select: { name: true } },
      form: true,
      strengthValue: true,
      strengthUnit: true,
      nafdacCode: true,
      prescriptionRequired: true,
      imageUrl: true,
      createdAt: true,
      availabilities: {
        select: {
          stock: true,
          price: true,
          pharmacy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!medication) {
    const error = new Error('Medication not found');
    error.status = 404;
    throw error;
  }
  console.log('Medication fetched:', { medicationId: id });
  return medication;
}

async function createMedication(data) {
  // Ensure required relations exist
  const genericMedication = await prisma.genericMedication.findUnique({ where: { id: data.genericMedicationId } });
  if (!genericMedication) throw new Error('Generic medication not found');
  let manufacturer = null;
  if (data.manufacturerId) {
    manufacturer = await prisma.manufacturer.findUnique({ where: { id: data.manufacturerId } });
    if (!manufacturer) throw new Error('Manufacturer not found');
  }
  const medication = await prisma.medication.create({
    data: {
      brandName: data.brandName,
      genericMedicationId: data.genericMedicationId,
      brandDescription: data.brandDescription,
      manufacturerId: data.manufacturerId,
      form: data.form,
      strengthValue: data.strengthValue,
      strengthUnit: data.strengthUnit,
      route: data.route,
      packSizeQuantity: data.packSizeQuantity,
      packSizeUnit: data.packSizeUnit,
      isCombination: data.isCombination,
      combinationDescription: data.combinationDescription,
      nafdacCode: data.nafdacCode,
      nafdacStatus: data.nafdacStatus,
      prescriptionRequired: data.prescriptionRequired,
      regulatoryClass: data.regulatoryClass,
      restrictedTo: data.restrictedTo,
      insuranceCoverage: data.insuranceCoverage,
      approvalDate: data.approvalDate ? new Date(data.approvalDate) : undefined,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
      storageConditions: data.storageConditions,
      imageUrl: data.imageUrl,
      createdAt: new Date(),
    },
    select: {
      id: true,
      brandName: true,
      genericMedication: { select: { name: true } },
      brandDescription: true,
      manufacturer: { select: { name: true } },
      form: true,
      strengthValue: true,
      strengthUnit: true,
      nafdacCode: true,
      prescriptionRequired: true,
      imageUrl: true,
      createdAt: true,
    },
  });
  console.log('Medication created:', { medicationId: medication.id });
  return medication;
}


async function updateMedication(id, data) {
  try {
    const medication = await prisma.medication.update({
      where: { id },
      data,
      select: {
        id: true,
        brandName: true,
        genericMedication: { select: { name: true } },
        description: true,
        manufacturer: { select: { name: true } },
        form: true,
        strengthValue: true,
        strengthUnit: true,
        nafdacCode: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        availabilities: {
          select: {
            stock: true,
            price: true,
            pharmacy: { select: { id: true, name: true } },
          },
        },
      },
    });
    console.log('Medication updated:', { medicationId: id });
    return medication;
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Medication not found');
      err.status = 404;
      throw err;
    }
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


async function getPrescriptions({ page, limit, status, patientIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status.toUpperCase();
  if (patientIdentifier) where.userIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
  const [prescriptions, total] = await prisma.$transaction([
    prisma.prescription.findMany({
      where,
      select: {
        id: true,
        userIdentifier: true,
        fileUrl: true,
        status: true,
        verified: true,
        createdAt: true,
        orders: {
          select: {
            id: true,
            trackingCode: true,
            status: true,
            pharmacy: { select: { id: true, name: true } },
          },
        },
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
    const error = new Error('Prescription not found');
    error.status = 404;
    throw error;
  }
  console.log('Prescription fetched:', { prescriptionId: id });
  return prescription;
}

async function getOrders({ page, limit, status, patientIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status.toUpperCase();
  if (patientIdentifier) where.userIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
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
      pharmacy: {
        select: { id: true, name: true },
      },
      prescription: {
        select: {
          id: true,
          userIdentifier: true,
          status: true,
          fileUrl: true,
        },
      },
      items: {
        select: {
          medicationAvailability: {
            select: {
              medication: {
                select: { id: true, brandName: true, genericMedication: { select: { name: true } } },
              },
              pharmacy: {
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
};