const { PrismaClient } = require('@prisma/client');
const NodeGeocoder = require('node-geocoder');
const prisma = new PrismaClient();

const geocoder = NodeGeocoder({
  provider: 'opencage',
  apiKey: process.env.OPENCAGE_API_KEY,
});

async function getDashboardOverview() {
  const [pharmacyCount, labCount, medicationCount, testCount, prescriptionCount, orderCount, bookingCount, userCount, labUserCount, pendingPrescriptions, pendingBookings, verifiedPharmacies, verifiedLabs, recentOrders, recentBookings] = await prisma.$transaction([
    prisma.pharmacy.count(),
    prisma.lab.count(),
    prisma.medication.count(),
    prisma.test.count(),
    prisma.prescription.count(),
    prisma.booking.count(),
    prisma.pharmacyUser.count(),
    prisma.labUser.count(),
    prisma.prescription.count({ where: { status: 'pending' } }),
    prisma.booking.count({ where: { status: 'pending' } }),
    prisma.pharmacy.count({ where: { status: 'verified' } }),
    prisma.lab.count({ where: { status: 'verified' } }),
    prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, trackingCode: true, patientIdentifier: true, totalPrice: true, status: true, createdAt: true },
    }),
    prisma.booking.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, trackingCode: true, patientIdentifier: true, totalPrice: true, status: true, createdAt: true },
    }),
  ]);
  const summary = {
    pharmacies: { total: pharmacyCount, verified: verifiedPharmacies },
    labs: { total: labCount, verified: verifiedLabs },
    medications: { total: medicationCount },
    tests: { total: testCount },
    prescriptions: { total: prescriptionCount, pending: pendingPrescriptions },
    bookings: { total: bookingCount, pending: pendingBookings },
    users: { total: userCount + labUserCount },
    orders: { total: orderCount, recent: recentOrders },
    bookings: { total: bookingCount, recent: recentBookings },
  };
  console.log('Dashboard data fetched:', summary);
  return summary;
}

async function getPharmacies({ page = 1, limit = 10 }) {
  const skip = (page - 1) * limit;

  const [pharmacies, total] = await prisma.$transaction([
    prisma.pharmacy.findMany({
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
    prisma.pharmacy.count(),
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

async function getLabs({ page = 1, limit = 10 }) {
  const skip = (page - 1) * limit;

  const [labs, total] = await prisma.$transaction([
    prisma.lab.findMany({
      select: {
        id: true,
        name: true,
        address: true,
        lga: true,
        state: true,
        phone: true,
        status: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        verifiedAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.lab.count(),
  ]);

  return {
    labs,
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

async function getSimpleLabs() {
  const simpleLabs = await prisma.lab.findMany({
    select: {
      id: true,
      name: true,
    },
  });
  console.log('Labs fetched for filter:', { count: simpleLabs.length });
  return simpleLabs;
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

async function getLab(id) {
  const lab = await prisma.lab.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      lga: true,
      state: true,
      phone: true,
      status: true,
      logoUrl: true,
      isActive: true,
      createdAt: true,
      verifiedAt: true,
    },
  });
  if (!lab) {
    const error = new Error('Lab not found');
    error.status = 404;
    throw error;
  }
  console.log('Lab fetched:', { labId: id });
  return lab;
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
        verifiedAt: data.status === 'verified' ? new Date() : data.status === 'rejected' ? null : existingPharmacy.verifiedAt,
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

async function updateLab(id, data) {
  const existingLab = await prisma.lab.findUnique({
    where: { id },
  });
  if (!existingLab) {
    const error = new Error('Lab not found');
    error.status = 404;
    throw error;
  }
  const addressString = `${data.address}, ${data.lga}, ${data.state}, Nigeria`;
  const geoResult = await geocoder.geocode(addressString);
  if (!geoResult.length) {
    const error = new Error('Invalid address: unable to geocode');
    error.status = 400;
    throw error;
  }
  const { latitude, longitude } = geoResult[0];
  const updatedLab = await prisma.$transaction(async (prisma) => {
    const lab = await prisma.lab.update({
      where: { id },
      data: {
        name: data.name,
        address: data.address,
        lga: data.lga,
        state: data.state,
        phone: data.phone,
        status: data.status,
        logoUrl: data.logoUrl,
        isActive: data.isActive,
        verifiedAt: data.status === 'verified' ? new Date() : data.status === 'rejected' ? null : existingLab.verifiedAt,
      },
    });
    await prisma.$queryRaw`
      UPDATE "Lab"
      SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      WHERE id = ${id}
    `;
    return lab;
  });
  console.log('Lab updated:', { labId: id });
  return {
    id: updatedLab.id,
    name: updatedLab.name,
    address: updatedLab.address,
    lga: updatedLab.lga,
    state: updatedLab.state,
    phone: updatedLab.phone,
    status: updatedLab.status,
    logoUrl: updatedLab.logoUrl,
    isActive: updatedLab.isActive,
    createdAt: updatedLab.createdAt,
    verifiedAt: updatedLab.verifiedAt,
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

async function deleteLab(id) {
  const existingLab = await prisma.lab.findUnique({
    where: { id },
  });
  if (!existingLab) {
    const error = new Error('Lab not found');
    error.status = 404;
    throw error;
  }
  await prisma.lab.delete({
    where: { id },
  });
  console.log('Lab deleted:', { labId: id });
}

async function getMedications({ page, limit, name, genericName, category, prescriptionRequired, pharmacyId }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (genericName) where.genericName = { contains: genericName, mode: 'insensitive' };
  if (category) where.category = { equals: category };
  if (prescriptionRequired !== undefined) where.prescriptionRequired = prescriptionRequired;
  if (pharmacyId) where.pharmacyMedications = { some: { pharmacyId } };
  const [medications, total] = await prisma.$transaction([
    prisma.medication.findMany({
      where,
      select: {
        id: true,
        name: true,
        genericName: true,
        category: true,
        description: true,
        manufacturer: true,
        form: true,
        dosage: true,
        nafdacCode: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        pharmacyMedications: {
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

async function getTests({ page, limit, name, orderRequired, labId }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (orderRequired !== undefined) where.orderRequired = orderRequired;
  if (labId) where.labTests = { some: { labId } };
  const [tests, total] = await prisma.$transaction([
    prisma.test.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        orderRequired: true,
        imageUrl: true,
        createdAt: true,
        labTests: {
          select: {
            price: true,
            lab: { select: { id: true, name: true } },
          },
        },
      },
      take: limit,
      skip,
    }),
    prisma.test.count({ where }),
  ]);
  console.log('Tests fetched:', { count: tests.length, total });
  return {
    tests,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getMedication(id) {
  const medication = await prisma.medication.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      genericName: true,
      category: true,
      description: true,
      manufacturer: true,
      form: true,
      dosage: true,
      nafdacCode: true,
      prescriptionRequired: true,
      imageUrl: true,
      createdAt: true,
      pharmacyMedications: {
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

async function getTest(id) {
  const test = await prisma.test.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      orderRequired: true,
      imageUrl: true,
      createdAt: true,
      labTests: {
        select: {
          price: true,
          lab: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!test) {
    const error = new Error('Test not found');
    error.status = 404;
    throw error;
  }
  console.log('Test fetched:', { testId: id });
  return test;
}

async function createMedication(data) {
  const medication = await prisma.medication.create({
    data: {
      ...data,
      createdAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      genericName: true,
      category: true,
      description: true,
      manufacturer: true,
      form: true,
      dosage: true,
      nafdacCode: true,
      prescriptionRequired: true,
      imageUrl: true,
      createdAt: true,
    },
  });
  console.log('Medication created:', { medicationId: medication.id });
  return medication;
}

async function createTest(data) {
  const test = await prisma.test.create({
    data: {
      ...data,
      createdAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      description: true,
      orderRequired: true,
      imageUrl: true,
      createdAt: true,
    },
  });
  console.log('Test created:', { testId: test.id });
  return test;
}

async function updateMedication(id, data) {
  try {
    const medication = await prisma.medication.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        genericName: true,
        category: true,
        description: true,
        manufacturer: true,
        form: true,
        dosage: true,
        nafdacCode: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        pharmacyMedications: {
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

async function updateTest(id, data) {
  try {
    const test = await prisma.test.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        description: true,
        orderRequired: true,
        imageUrl: true,
        createdAt: true,
        labTests: {
          select: {
            price: true,
            lab: { select: { id: true, name: true } },
          },
        },
      },
    });
    console.log('Test updated:', { testId: id });
    return test;
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Test not found');
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
        where: { pharmacyMedicationMedicationId: id },
      });
      await prisma.pharmacyMedication.deleteMany({
        where: { medicationId: id },
      });
      await prisma.medication.delete({
        where: { id },
      });
    });
    console.log('Medication, related PharmacyMedication, and OrderItem records deleted:', { medicationId: id });
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Medication not found');
      err.status = 404;
      throw err;
    }
    throw error;
  }
}

async function deleteTest(id) {
  try {
    await prisma.$transaction(async (prisma) => {
      await prisma.bookingItem.deleteMany({
        where: { labTestTestId: id },
      });
      await prisma.labTest.deleteMany({
        where: { testId: id },
      });
      await prisma.test.delete({
        where: { id },
      });
    });
    console.log('Test, related LabTest, and BookingItem records deleted:', { testId: id });
  } catch (error) {
    if (error.code === 'P2025') {
      const err = new Error('Test not found');
      err.status = 404;
      throw err;
    }
    throw error;
  }
}

async function getPrescriptions({ page, limit, status, patientIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status;
  if (patientIdentifier) where.patientIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
  const [prescriptions, total] = await prisma.$transaction([
    prisma.prescription.findMany({
      where,
      select: {
        id: true,
        patientIdentifier: true,
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
  if (status) where.status = status;
  if (patientIdentifier) where.patientIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        patientIdentifier: true,
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
      patientIdentifier: true,
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
          patientIdentifier: true,
          status: true,
          fileUrl: true,
          verified: true,
        },
      },
      items: {
        select: {
          pharmacyMedication: {
            select: {
              medication: {
                select: { id: true, name: true, genericName: true },
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

async function getBookings({ page, limit, status, patientIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status;
  if (patientIdentifier) where.patientIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
  const [bookings, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      select: {
        id: true,
        patientIdentifier: true,
        status: true,
        totalPrice: true,
        createdAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.booking.count({ where }),
  ]);
  console.log('Bookings fetched:', { count: bookings.length, total });
  return {
    bookings,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getBooking(id) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      patientIdentifier: true,
      status: true,
      totalPrice: true,
      deliveryMethod: true,
      address: true,
      email: true,
      phone: true,
      trackingCode: true,
      cancelledAt: true,
      cancelReason: true,
      paymentReference: true,
      paymentStatus: true,
      createdAt: true,
      updatedAt: true,
      lab: {
        select: { id: true, name: true },
      },
      items: {
        select: {
          labTest: {
            select: {
              test: {
                select: { id: true, name: true },
              },
              lab: {
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
  if (!booking) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }
  console.log('Booking fetched:', { bookingId: id });
  return booking;
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

async function getLabUsers({ page, limit, role, email, labId }) {
  const skip = (page - 1) * limit;
  const where = {};
  if (role) where.role = role;
  if (email) where.email = { contains: email, mode: 'insensitive' };
  if (labId) where.labId = labId;
  const [users, total] = await prisma.$transaction([
    prisma.labUser.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lab: {
          select: { id: true, name: true },
        },
      },
      take: limit,
      skip,
    }),
    prisma.labUser.count({ where }),
  ]);
  console.log('Lab users fetched:', { count: users.length, total });
  return {
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getLabUser(id) {
  const user = await prisma.labUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastLogin: true,
      lab: {
        select: { id: true, name: true },
      },
    },
  });
  if (!user) {
    const error = new Error('Lab user not found');
    error.status = 404;
    throw error;
  }
  console.log('Lab user fetched:', { userId: id });
  return user;
}

module.exports = {
  getDashboardOverview,
  getPharmacies,
  getLabs,
  getSimplePharmacies,
  getSimpleLabs,
  getPharmacy,
  getLab,
  updatePharmacy,
  updateLab,
  deletePharmacy,
  deleteLab,
  getMedications,
  getTests,
  getMedication,
  getTest,
  createMedication,
  createTest,
  updateMedication,
  updateTest,
  deleteMedication,
  deleteTest,
  getPrescriptions,
  getPrescription,
  getOrders,
  getOrder,
  getBookings,
  getBooking,
  getAdminUsers,
  getAdminUser,
  getPharmacyUsers,
  getPharmacyUser,
  getLabUsers,
  getLabUser,
};