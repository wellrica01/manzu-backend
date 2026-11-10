/**
 * PHARMACY ANALYTICS SERVICE (G8)
 *
 * Composes the raw counts into the shape the mobile Analytics screen expects.
 * Matches mobile `computeOrderAnalytics` + `computeInventoryHealth` exactly, so
 * the app can drop its in-JS aggregation.
 */

const repository = require('./pharmacy-analytics.repository');

const DEFAULT_RANGE_DAYS = 30;

function dayLabel(day) {
  const d = new Date(day + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function parseRange(from, to) {
  const end = to ? new Date(to + 'T23:59:59.999Z') : new Date();
  const start = from ? new Date(from + 'T00:00:00.000Z') : new Date(end.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error('Invalid from/to dates (expected YYYY-MM-DD)');
    err.status = 400;
    err.code = 'INVALID_DATE_RANGE';
    throw err;
  }
  if (start > end) {
    const err = new Error('"from" must be before "to"');
    err.status = 400;
    err.code = 'INVALID_DATE_RANGE';
    throw err;
  }
  return { from: start, to: end };
}

async function getAnalytics(pharmacyId, { from, to } = {}) {
  const range = parseRange(from, to);

  const [orderData, inventoryHealth] = await Promise.all([
    repository.getOrderAnalytics(pharmacyId, range),
    repository.getInventoryHealth(pharmacyId),
  ]);

  const avgOrderValue = orderData.totalOrders ? orderData.totalPrice / orderData.totalOrders : 0;
  const retentionRate = orderData.uniqueCustomers
    ? Math.round((orderData.returningCustomers / orderData.uniqueCustomers) * 100)
    : 0;

  return {
    period: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
    totalRevenue: orderData.totalRevenue,
    totalOrders: orderData.totalOrders,
    avgOrderValue,
    uniqueCustomers: orderData.uniqueCustomers,
    returningCustomers: orderData.returningCustomers,
    retentionRate,
    statusCounts: orderData.statusGroups.map((g) => ({ status: g.status, count: g._count.id })),
    topMedications: orderData.topMeds.map((m) => ({
      name: m.name,
      count: Number(m.count),
      revenue: Number(m.revenue),
    })),
    revenueByDay: orderData.dailyRevenue.map((d) => ({
      day: d.day,
      label: dayLabel(d.day),
      revenue: Number(d.revenue),
    })),
    inventoryHealth,
  };
}

module.exports = { getAnalytics };