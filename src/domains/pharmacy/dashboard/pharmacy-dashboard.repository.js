/**
 * PHARMACY DASHBOARD REPOSITORY
 * 
 * Database access layer for pharmacy dashboard operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Get dashboard metrics for a pharmacy
 */
async function getDashboardMetrics(pharmacyId, { startOfDay, endOfDay, startOfYesterday, endOfYesterday }) {
  return await Promise.all([
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
    // Ready for pickup
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: 'READY_FOR_PICKUP',
      },
    }),
    // Inventory alerts
    prisma.medicationAvailability.count({
      where: { pharmacyId, stock: { lt: 10 } },
    }),
    // Expiring meds
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
      where: { pharmacyId, createdAt: { gte: startOfDay, lte: endOfDay } },
    }),
    // PoS sales yesterday
    prisma.sale.count({
      where: { pharmacyId, createdAt: { gte: startOfYesterday, lte: endOfYesterday } },
    }),
    // PoS revenue today
    prisma.sale.aggregate({
      _sum: { total: true },
      where: { pharmacyId, createdAt: { gte: startOfDay, lte: endOfDay } },
    }),
    // PoS revenue yesterday
    prisma.sale.aggregate({
      _sum: { total: true },
      where: { pharmacyId, createdAt: { gte: startOfYesterday, lte: endOfYesterday } },
    }),
  ]);
}

/**
 * Get top selling medications
 */
async function getTopSellingMedications(pharmacyId) {
  return await prisma.$queryRaw`
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
  `;
}

/**
 * Get recent orders
 */
async function getRecentOrders(pharmacyId) {
  return await prisma.order.findMany({
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
  });
}

/**
 * Get recent sales
 */
async function getRecentSales(pharmacyId) {
  return await prisma.sale.findMany({
    where: { pharmacyId },
    select: {
      id: true,
      total: true,
      paymentMethod: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}

/**
 * Get low stock medications
 */
async function getLowStockMedications(pharmacyId) {
  return await prisma.medicationAvailability.findMany({
    where: { pharmacyId, stock: { lt: 10, gt: 0 } },
    include: {
      Medication: { select: { brandName: true, form: true } },
    },
    orderBy: { stock: 'asc' },
    take: 5,
  });
}

/**
 * Get weekly analytics
 */
async function getWeeklyAnalytics(pharmacyId, weekAgo) {
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

  return { dailyStats, posDailyStats };
}

module.exports = {
  getDashboardMetrics,
  getTopSellingMedications,
  getRecentOrders,
  getRecentSales,
  getLowStockMedications,
  getWeeklyAnalytics,
};