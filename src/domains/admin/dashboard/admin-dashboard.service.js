/**
 * ADMIN DASHBOARD SERVICE
 * 
 * Business logic for admin dashboard metrics and analytics
 */

const dashboardRepository = require('./admin-dashboard.repository');

/**
 * Get comprehensive dashboard overview
 */
async function getDashboardOverview() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Fetch all metrics in a single transaction
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
  ] = await dashboardRepository.getDashboardMetrics(thirtyDaysAgo, sevenDaysAgo, sixtyDaysAgo);

  // Safe growth calculation function
  const calcGrowth = (recent, previous) =>
    previous > 0 ? ((recent - previous) / previous * 100).toFixed(1) : recent > 0 ? 100 : 0;

  const userGrowthRate = calcGrowth(newUsersLast30Days, newUsersLast60To30Days);
  const pharmacyGrowthRate = calcGrowth(newPharmaciesLast30Days, newPharmaciesLast60To30Days);
  const orderGrowthRate = calcGrowth(ordersLast30Days, ordersLast60To30Days);

  // Safe status mapping function
  const mapStatus = (arr) =>
    arr?.reduce((acc, item) => {
      acc[item.status?.toLowerCase()] = item._count?.status || 0;
      return acc;
    }, {}) || {};

  // Assemble dashboard summary
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

module.exports = {
  getDashboardOverview,
};