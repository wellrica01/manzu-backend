/**
 * PHARMACY DASHBOARD REPOSITORY - OPTIMIZED
 * 
 * Reduced from 13 queries to 8 queries by combining similar operations
 * Uses groupBy and single aggregate queries where possible
 */

const prisma = require('../../../core/database/prisma');

/**
 * Get dashboard metrics for a pharmacy
 * OPTIMIZED: Reduced query count by combining similar queries
 */
async function getDashboardMetrics(pharmacyId, { startOfDay, endOfDay, startOfYesterday, endOfYesterday }) {
  // Batch 1: Order counts by status (3 queries → 1 query)
  const ordersByStatus = prisma.order.groupBy({
    by: ['status'],
    where: {
      OrderItem: { some: { pharmacyId } },
    },
    _count: { id: true },
  });

  // Batch 2: Order counts by date range (2 queries → 1 query with raw SQL)
  const orderDateCounts = prisma.$queryRaw`
    SELECT 
      COUNT(DISTINCT o.id) FILTER (WHERE o."createdAt" >= ${startOfDay} AND o."createdAt" <= ${endOfDay}) as orders_today,
      COUNT(DISTINCT o.id) FILTER (WHERE o."createdAt" >= ${startOfYesterday} AND o."createdAt" <= ${endOfYesterday}) as orders_yesterday
    FROM "Order" o
    INNER JOIN "OrderItem" oi ON o.id = oi."orderId"
    WHERE oi."pharmacyId" = ${pharmacyId}
      AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION')
  `;

  // Batch 3: Revenue aggregates (2 queries → 1 query with raw SQL)
  const orderRevenue = prisma.$queryRaw`
    SELECT 
      COALESCE(SUM(o."pharmacyAmount") FILTER (WHERE o."createdAt" >= ${startOfDay} AND o."createdAt" <= ${endOfDay}), 0) as revenue_today,
      COALESCE(SUM(o."pharmacyAmount") FILTER (WHERE o."createdAt" >= ${startOfYesterday} AND o."createdAt" <= ${endOfYesterday}), 0) as revenue_yesterday
    FROM "Order" o
    INNER JOIN "OrderItem" oi ON o.id = oi."orderId"
    WHERE oi."pharmacyId" = ${pharmacyId}
      AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED')
  `;

  // Batch 4: Inventory alerts (stays as 2 separate queries - different conditions)
  const inventoryAlerts = prisma.medicationAvailability.count({
    where: { pharmacyId, stock: { lt: 10 } },
  });

  const expiringMeds = prisma.medicationAvailability.count({
    where: {
      pharmacyId,
      expiryDate: {
        gte: new Date(),
        lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    },
  });

  // Batch 5: PoS sales metrics (4 queries → 1 query with raw SQL)
  const posSalesMetrics = prisma.$queryRaw`
    SELECT 
      COUNT(id) FILTER (WHERE "createdAt" >= ${startOfDay} AND "createdAt" <= ${endOfDay}) as sales_today,
      COUNT(id) FILTER (WHERE "createdAt" >= ${startOfYesterday} AND "createdAt" <= ${endOfYesterday}) as sales_yesterday,
      COALESCE(SUM(total) FILTER (WHERE "createdAt" >= ${startOfDay} AND "createdAt" <= ${endOfDay}), 0) as revenue_today,
      COALESCE(SUM(total) FILTER (WHERE "createdAt" >= ${startOfYesterday} AND "createdAt" <= ${endOfYesterday}), 0) as revenue_yesterday
    FROM "Sale"
    WHERE "pharmacyId" = ${pharmacyId}
  `;

  // Execute all batches in parallel (8 queries instead of 13)
  const [
    orderStatusGroups,
    [orderDateResult],
    [orderRevenueResult],
    lowStockCount,
    expiringCount,
    [posMetricsResult],
  ] = await Promise.all([
    ordersByStatus,
    orderDateCounts,
    orderRevenue,
    inventoryAlerts,
    expiringMeds,
    posSalesMetrics,
  ]);

  // Extract order status counts
  const getStatusCount = (status) => {
    const found = orderStatusGroups.find(g => g.status === status);
    return found ? found._count.id : 0;
  };

  return {
    ordersToday: Number(orderDateResult.orders_today),
    ordersYesterday: Number(orderDateResult.orders_yesterday),
    pendingOrders: getStatusCount('CONFIRMED'),
    processingOrders: getStatusCount('PROCESSING'),
    readyOrders: getStatusCount('READY_FOR_PICKUP'),
    inventoryAlerts: lowStockCount,
    expiringMeds: expiringCount,
    revenueToday: Number(orderRevenueResult.revenue_today),
    revenueYesterday: Number(orderRevenueResult.revenue_yesterday),
    posSalesToday: Number(posMetricsResult.sales_today),
    posSalesYesterday: Number(posMetricsResult.sales_yesterday),
    posRevenueToday: Number(posMetricsResult.revenue_today),
    posRevenueYesterday: Number(posMetricsResult.revenue_yesterday),
  };
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
      pharmacyAmount: true,
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