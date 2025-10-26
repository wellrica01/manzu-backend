/**
 * PHARMACY DASHBOARD SERVICE
 * 
 * Business logic for pharmacy dashboard operations
 */

const repository = require('./pharmacy-dashboard.repository');

/**
 * Get dashboard data for a pharmacy
 */
async function getDashboardData(pharmacyId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Yesterday range
  const startOfYesterday = new Date(startOfDay);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const endOfYesterday = new Date(endOfDay);
  endOfYesterday.setDate(endOfYesterday.getDate() - 1);

  // Get all metrics in parallel
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
  ] = await repository.getDashboardMetrics(pharmacyId, {
    startOfDay,
    endOfDay,
    startOfYesterday,
    endOfYesterday,
  });

  // Get additional data
  const [topSellingMeds, recentOrders, recentSales, lowStockMeds] = await Promise.all([
    repository.getTopSellingMedications(pharmacyId),
    repository.getRecentOrders(pharmacyId),
    repository.getRecentSales(pharmacyId),
    repository.getLowStockMedications(pharmacyId),
  ]);

  // Calculations
  const revenueToday = revenueTodayResult._sum.totalPrice || 0;
  const revenueYesterday = revenueYesterdayResult._sum.totalPrice || 0;
  const posRevenueToday = posRevenueTodayResult._sum.total || 0;
  const posRevenueYesterday = posRevenueYesterdayResult._sum.total || 0;

  const calculateTrend = (today, yesterday) => {
    if (yesterday === 0) return today > 0 ? 100 : 0;
    return Math.round(((today - yesterday) / yesterday) * 100);
  };

  // Merge Orders + Sales for recent activity
  const normalizedOrders = recentOrders.map(o => ({
    id: o.id,
    type: 'ORDER',
    name: o.name,
    status: o.status,
    amount: o.totalPrice,
    time: o.createdAt,
  }));

  const normalizedSales = recentSales.map(s => ({
    id: s.id,
    type: 'SALE',
    name: 'POS Sale',
    status: s.paymentMethod?.toUpperCase() || 'PAID',
    amount: s.total,
    time: s.createdAt,
  }));

  const recentActivity = [...normalizedOrders, ...normalizedSales]
    .sort((a, b) => b.time - a.time)
    .slice(0, 10);

  // Final return
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
    recentActivity,
    lowStockMeds: lowStockMeds.map(med => ({
      name: med.Medication.brandName,
      form: med.Medication.form,
      stock: med.stock,
      price: med.price,
    })),
  };
}

/**
 * Get weekly analytics for a pharmacy
 */
async function getWeeklyAnalytics(pharmacyId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const { dailyStats, posDailyStats } = await repository.getWeeklyAnalytics(pharmacyId, weekAgo);

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

module.exports = {
  getDashboardData,
  getWeeklyAnalytics,
};