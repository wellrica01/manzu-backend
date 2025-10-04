const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { validateLocation } = require('../utils/location');
const { ZodError } = require('zod');

async function fetchOrders(pharmacyId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;

  // Total count
  const total = await prisma.order.count({
    where: {
      OrderItem: {
        some: { pharmacyId },
      },
      status: {
        notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'],
      },
    },
  });

  // Fetch paginated orders
  const orders = await prisma.order.findMany({
    where: {
      OrderItem: { some: { pharmacyId } },
      status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      trackingCode: true,
      userIdentifier: true,
      deliveryMethod: true,
      address: true,
      status: true,
      totalPrice: true,
      Prescription: { select: { id: true, fileUrl: true, status: true } },
      OrderItem: {
        select: {
          id: true,
          quantity: true,
          price: true,
          pharmacyId: true,
          medicationId: true,
          MedicationAvailability: {
            select: {
              Medication: {
                select: {
                  brandName: true,
                  form: true,
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: { 
                          ActiveSubstance: { select: { name: true } }
                         },
                      },
                    },
                  },
                },
              },
              Pharmacy: { select: { name: true, address: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  return {
    orders: orders.map(order => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      trackingCode: order.trackingCode,
      userIdentifier: order.userIdentifier,
      deliveryMethod: order.deliveryMethod,
      address: order.address,
      status: order.status,
      totalPrice: order.totalPrice,
      prescription: order.Prescription
        ? { id: order.Prescription.id, fileUrl: order.Prescription.fileUrl, status: order.Prescription.status }
        : null,
      items: order.OrderItem
        .filter(item => item.pharmacyId === pharmacyId)
        .map(item => {
          const activeSubstances = item.MedicationAvailability.Medication.Medication_MedicationIngredient
            .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
            .join(', ');

          return {
            id: item.id,
            medication: {
              brandName: item.MedicationAvailability.Medication.brandName,
              activeSubstances,
              displayName: `${item.MedicationAvailability.Medication.brandName} (${activeSubstances}) ${item.MedicationAvailability.Medication.form ?? ''}`,
            },
            pharmacy: {
              name: item.MedicationAvailability.Pharmacy.name,
              address: item.MedicationAvailability.Pharmacy.address,
            },
            quantity: item.quantity,
            price: item.price,
          };
        }),
    })),
    total,
  };
}

async function updateOrderStatus(orderId, status, pharmacyId) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      OrderItem: {
        some: {
          pharmacyId,
        },
      },
    },
  });
  if (!order) {
    throw new Error('Order not found for pharmacy');
  }

  const updateData = { status };
  if (status === 'DELIVERED' || status === 'READY_FOR_PICKUP') {
    updateData.filledAt = new Date();
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: updateData,
  });

  console.log('Order status updated:', { orderId, status: updatedOrder.status, filledAt: updatedOrder.filledAt });
  return updatedOrder;
}

async function fetchMedications(pharmacyId) {
  const medications = await prisma.medicationAvailability.findMany({
    where: { pharmacyId },
    include: {
      Medication: {
        include: {
          Medication_MedicationIngredient: {
            include: {
              MedicationIngredient: { include: { ActiveSubstance: true } },
            },
          },
        },
      },
    },
  });

  const allMedications = await prisma.medication.findMany({
    include: {
      Medication_MedicationIngredient: {
        include: { MedicationIngredient: { include: { ActiveSubstance: true } } },
      },
    },
  });

  return {
    medications: medications.map(m => {
      const activeSubstances = m.Medication.Medication_MedicationIngredient
        .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
        .join(', ');

      return {
        pharmacyId: m.pharmacyId,
        medicationId: m.medicationId,
        brandName: m.Medication.brandName,
        activeSubstances,
        displayName: `${m.Medication.brandName} (${activeSubstances}) ${m.Medication.form ?? ''}`,
        stock: m.stock,
        price: m.price,
        expiryDate: m.expiryDate,
        receivedDate: m.receivedDate,
      };
    }),
    availableMedications: allMedications.map(m => {
      const activeSubstances = m.Medication_MedicationIngredient
        .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
        .join(', ');

      return {
        id: m.id,
        brandName: m.brandName,
        activeSubstances,
        displayName: `${m.brandName} (${activeSubstances}) ${m.form ?? ''}`,
      };
    }),
  };
}

/**
 * Add medication to pharmacy inventory
 */
async function addMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate }) {
  const existing = await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });
  if (existing) throw new Error('Medication already exists in pharmacy inventory');

  const medication = await prisma.medicationAvailability.create({
    data: {
      pharmacyId,
      medicationId,
      stock,
      price,
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    },
    include: {
      medication: { include: { Medication_MedicationIngredient: { include: { MedicationIngredient: { include: { ActiveSubstance: true } } } } } },
    },
  });

  const activeSubstances = medication.Medication.Medication_MedicationIngredient
    .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
    .join(', ');

  return {
    pharmacyId: medication.pharmacyId,
    medicationId: medication.medicationId,
    brandName: medication.Medication.brandName,
    activeSubstances,
    stock: medication.stock,
    price: medication.price,
    receivedDate: medication.receivedDate,
    expiryDate: medication.expiryDate,
  };
}

/**
 * Update medication in pharmacy inventory
 */
async function updateMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate }) {
  const medication = await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    include: {
      medication: { include: { Medication_MedicationIngredient: { include: { MedicationIngredient: { include: { ActiveSubstance: true } } } } } },
    },
  });
  if (!medication) throw new Error('Medication not found');

  const updatedMedication = await prisma.medicationAvailability.update({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    data: {
      stock,
      price,
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    },
    include: {
      medication: { include: { Medication_MedicationIngredient: { include: { MedicationIngredient: { include: { ActiveSubstance: true } } } } } },
    },
  });

  const activeSubstances = updatedMedication.Medication.Medication_MedicationIngredient
    .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
    .join(', ');

  return {
    pharmacyId: updatedMedication.pharmacyId,
    medicationId: updatedMedication.medicationId,
    brandName: updatedMedication.Medication.brandName,
    activeSubstances,
    stock: updatedMedication.stock,
    price: updatedMedication.price,
    receivedDate: updatedMedication.receivedDate,
    expiryDate: updatedMedication.expiryDate,
  };
}

async function deleteMedication(pharmacyId, medicationId) {
  const medication = await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });
  if (!medication) {
    throw new Error('Medication not found');
  }

  await prisma.medicationAvailability.delete({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });

  console.log('Medication deleted:', { pharmacyId, medicationId });
}

async function fetchUsers(pharmacyId) {
  const users = await prisma.pharmacyUser.findMany({
    where: { pharmacyId },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log('Users fetched:', { pharmacyId, userCount: users.length });
  return users;
}

async function registerDevice(pharmacyId, deviceToken) {
  await prisma.pharmacy.update({
    where: { id: pharmacyId },
    data: { devicetoken: deviceToken },
  });
  console.log('Device registered:', { pharmacyId });
}

async function getProfile(userId, pharmacyId) {
  const user = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { id: true, name: true, address: true, lga: true, state: true, ward: true, phone: true, licenseNumber: true, status: true, logoUrl: true },
  });
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }

  console.log('Profile fetched:', { userId, pharmacyId });

  return { user, pharmacy };
}

async function editProfile({ user, pharmacy }, userId, pharmacyId) {
  validateLocation(pharmacy.state, pharmacy.lga, pharmacy.ward, pharmacy.latitude, pharmacy.longitude);

  const existingUser = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
  });
  if (user.email !== existingUser.email) {
    const emailConflict = await prisma.pharmacyUser.findUnique({
      where: { email: user.email },
    });
    if (emailConflict) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
    }
  }

  const result = await prisma.$transaction(async (prisma) => {
    const updatedUser = await prisma.pharmacyUser.update({
      where: { id: userId },
      data: { name: user.name, email: user.email },
    });

    const updatedPharmacy = await prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: {
        name: pharmacy.name,
        address: pharmacy.address,
        lga: pharmacy.lga,
        state: pharmacy.state,
        ward: pharmacy.ward,
        phone: pharmacy.phone,
        logoUrl: pharmacy.logoUrl || null,
      },
    });

    await prisma.$queryRaw`
      UPDATE "Pharmacy"
      SET location = ST_SetSRID(ST_MakePoint(${pharmacy.longitude}, ${pharmacy.latitude}), 4326)
      WHERE id = ${pharmacyId}
    `;

    return { user: updatedUser, pharmacy: updatedPharmacy };
  });

  console.log('Profile updated:', { userId, pharmacyId });

  return { updatedUser: result.user, updatedPharmacy: result.pharmacy };
}

async function getDashboardData(pharmacyId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Get yesterday for comparison
  const startOfYesterday = new Date(startOfDay);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const endOfYesterday = new Date(endOfDay);
  endOfYesterday.setDate(endOfYesterday.getDate() - 1);

  // Parallel queries for better performance
  const [
    ordersToday,
    ordersYesterday,
    pendingOrders,
    processingOrders,
    readyOrders,
    inventoryAlerts,
    expiringMeds,
    revenueTodayResult,
    revenueYesterdayResult,
    posSalesToday,
    posSalesYesterday,
    posRevenueTodayResult,
    posRevenueYesterdayResult,
    topSellingMeds,
    recentActivity,
    lowStockMeds,
  ] = await Promise.all([
    // Orders today
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
    // Orders yesterday
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
        createdAt: { gte: startOfYesterday, lte: endOfYesterday },
      },
    }),
    // Pending orders
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: 'CONFIRMED',
      },
    }),
    // Processing orders
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: 'PROCESSING',
      },
    }),
    // Ready for pickup orders
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: 'READY_FOR_PICKUP',
      },
    }),
    // Total inventory alerts (stock < 10)
    prisma.medicationAvailability.count({
      where: { pharmacyId, stock: { lt: 10 } },
    }),
    // Expiring medications (within 30 days)
    prisma.medicationAvailability.count({
      where: {
        pharmacyId,
        expiryDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    // Revenue today
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED'] },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
    // Revenue yesterday
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED'] },
        createdAt: { gte: startOfYesterday, lte: endOfYesterday },
      },
    }),
    // PoS sales today
    prisma.sale.count({
      where: {
        pharmacyId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
    // PoS sales yesterday
    prisma.sale.count({
      where: {
        pharmacyId,
        createdAt: { gte: startOfYesterday, lte: endOfYesterday },
      },
    }),
    // PoS revenue today
    prisma.sale.aggregate({
      _sum: { total: true },
      where: {
        pharmacyId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
    // PoS revenue yesterday
    prisma.sale.aggregate({
      _sum: { total: true },
      where: {
        pharmacyId,
        createdAt: { gte: startOfYesterday, lte: endOfYesterday },
      },
    }),
    // Top selling medications (last 7 days)
    prisma.$queryRaw`
      SELECT 
        m."brandName",
        COUNT(oi.id) as order_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue
      FROM "OrderItem" oi
      INNER JOIN "MedicationAvailability" ma ON oi."medicationId" = ma."medicationId" AND oi."pharmacyId" = ma."pharmacyId"
      INNER JOIN "Medication" m ON ma."medicationId" = m.id
      INNER JOIN "Order" o ON oi."orderId" = o.id
      WHERE oi."pharmacyId" = ${pharmacyId}
        AND o."createdAt" >= NOW() - INTERVAL '7 days'
        AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED')
      GROUP BY m.id, m."brandName"
      ORDER BY total_quantity DESC
      LIMIT 5
    `,
    // Recent activity (last 10 orders)
    prisma.order.findMany({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
      },
      select: {
        id: true,
        status: true,
        totalPrice: true,
        createdAt: true,
        name: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    // Low stock medications details
    prisma.medicationAvailability.findMany({
      where: {
        pharmacyId,
        stock: { lt: 10, gt: 0 },
      },
      include: {
        Medication: {
          select: {
            brandName: true,
            form: true,
          },
        },
      },
      orderBy: { stock: 'asc' },
      take: 5,
    }),
  ]);

  const revenueToday = revenueTodayResult._sum.totalPrice || 0;
  const revenueYesterday = revenueYesterdayResult._sum.totalPrice || 0;
  const posRevenueToday = posRevenueTodayResult._sum.total || 0;
  const posRevenueYesterday = posRevenueYesterdayResult._sum.total || 0;

  // Calculate trends
  const calculateTrend = (today, yesterday) => {
    if (yesterday === 0) return today > 0 ? 100 : 0;
    return Math.round(((today - yesterday) / yesterday) * 100);
  };

  return {
    ordersToday,
    ordersTrend: calculateTrend(ordersToday, ordersYesterday),
    posSalesToday,
    posSalesTrend: calculateTrend(posSalesToday, posSalesYesterday),
    revenueToday,
    revenueTrend: calculateTrend(revenueToday, revenueYesterday),
    posRevenueToday,
    posRevenueTrend: calculateTrend(posRevenueToday, posRevenueYesterday),
    pendingOrders,
    processingOrders,
    readyOrders,
    inventoryAlerts,
    expiringMeds,
    topSellingMeds: topSellingMeds.map(med => ({
      name: med.brandName,
      quantity: Number(med.total_quantity),
      revenue: Number(med.total_revenue),
      orders: Number(med.order_count),
    })),
    recentActivity: recentActivity.map(order => ({
      id: order.id,
      name: order.name,
      status: order.status,
      amount: order.totalPrice,
      time: order.createdAt,
    })),
    lowStockMeds: lowStockMeds.map(med => ({
      name: med.Medication.brandName,
      form: med.Medication.form,
      stock: med.stock,
      price: med.price,
    })),
  };
}


async function getWeeklyAnalytics(pharmacyId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const dailyStats = await prisma.$queryRaw`
    SELECT 
      DATE(o."createdAt") as date,
      COUNT(DISTINCT o.id) as orders,
      SUM(o."totalPrice") as revenue
    FROM "Order" o
    INNER JOIN "OrderItem" oi ON o.id = oi."orderId"
    WHERE oi."pharmacyId" = ${pharmacyId}
      AND o."createdAt" >= ${weekAgo}
      AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED')
    GROUP BY DATE(o."createdAt")
    ORDER BY date DESC
  `;

  const posDailyStats = await prisma.$queryRaw`
    SELECT 
      DATE("createdAt") as date,
      COUNT(id) as sales,
      SUM(total) as revenue
    FROM "Sale"
    WHERE "pharmacyId" = ${pharmacyId}
      AND "createdAt" >= ${weekAgo}
    GROUP BY DATE("createdAt")
    ORDER BY date DESC
  `;

  return {
    onlineOrders: dailyStats.map(stat => ({
      date: stat.date,
      orders: Number(stat.orders),
      revenue: Number(stat.revenue),
    })),
    posSales: posDailyStats.map(stat => ({
      date: stat.date,
      sales: Number(stat.sales),
      revenue: Number(stat.revenue),
    })),
  };
}

async function recordSale({ pharmacyId, items, total, paymentMethod }) {
  // Decrement stock for each item
  await Promise.all(items.map(async (item) => {
    const { medicationId, quantity } = item;
    const medAvail = await prisma.medicationAvailability.findUnique({
      where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    });
    if (!medAvail) throw new Error(`Medication ${medicationId} not found in pharmacy inventory`);
    if (medAvail.stock < quantity) throw new Error(`Insufficient stock for medication ${medicationId}`);
    await prisma.medicationAvailability.update({
      where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
      data: { stock: { decrement: quantity } },
    });
  }));
  // Create the sale
  const sale = await prisma.sale.create({
    data: {
      pharmacyId,
      items,
      total,
      paymentMethod,
    },
  });
  return sale;
}

async function fetchSales(pharmacyId, date) {
  let where = { pharmacyId };
  if (date) {
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');
    where.createdAt = { gte: start, lte: end };
  }
  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return sales;
}

module.exports = {
  fetchOrders,
  updateOrderStatus,
  fetchMedications,
  addMedication,
  updateMedication,
  deleteMedication,
  fetchUsers,
  registerDevice,
  getProfile,
  editProfile,
  getDashboardData,
  getWeeklyAnalytics,
  recordSale,
  fetchSales,
};