/**
 * PHARMACY ANALYTICS REPOSITORY (G8)
 *
 * Server-side aggregation so the mobile app doesn't paginate /orders and sum in JS.
 * All queries are scoped by pharmacyId and bounded by a date range.
 */

const prisma = require('../../../core/database/prisma');

const EXCLUDED_STATUSES = ['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED'];

async function getOrderAnalytics(pharmacyId, { from, to }) {
  const where = {
    OrderItem: { some: { pharmacyId } },
    status: { notIn: EXCLUDED_STATUSES },
    createdAt: { gte: from, lte: to },
  };

  // 1. Totals + unique customers
  const [totals, uniqueCustomers, returningCustomers] = await Promise.all([
    prisma.order.aggregate({
      where,
      _sum: { pharmacyAmount: true, totalPrice: true },
      _count: { id: true },
    }),
    prisma.order.groupBy({ by: ['userIdentifier'], where, _count: { id: true } }),
    prisma.order.groupBy({ by: ['userIdentifier'], where, having: { id: { _count: { gt: 1 } } }, _count: { id: true } }),
  ]);

  // 2. Status distribution
  const statusGroups = await prisma.order.groupBy({
    by: ['status'],
    where,
    _count: { id: true },
  });

  // 3. Top medications (by quantity) — raw SQL for the aggregate across OrderItem × Medication
  const topMeds = await prisma.$queryRaw`
    SELECT
      m."brandName" AS name,
      SUM(oi.quantity)::int AS count,
      SUM(oi.price * oi.quantity)::float AS revenue
    FROM "OrderItem" oi
    INNER JOIN "Order" o ON oi."orderId" = o.id
    INNER JOIN "MedicationAvailability" ma ON oi."medicationId" = ma."medicationId" AND oi."pharmacyId" = ma."pharmacyId"
    INNER JOIN "Medication" m ON ma."medicationId" = m.id
    WHERE oi."pharmacyId" = ${pharmacyId}
      AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED')
      AND o."createdAt" >= ${from}
      AND o."createdAt" <= ${to}
    GROUP BY m.id, m."brandName"
    ORDER BY count DESC
    LIMIT 5
  `;

  // 4. Revenue per day
  const dailyRevenue = await prisma.$queryRaw`
    SELECT
      TO_CHAR(DATE(o."createdAt"), 'YYYY-MM-DD') AS day,
      SUM(o."totalPrice")::float AS revenue
    FROM "Order" o
    INNER JOIN "OrderItem" oi ON oi."orderId" = o.id
    WHERE oi."pharmacyId" = ${pharmacyId}
      AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED')
      AND o."createdAt" >= ${from}
      AND o."createdAt" <= ${to}
    GROUP BY DATE(o."createdAt")
    ORDER BY day ASC
  `;

  return {
    totalRevenue: Number(totals._sum.pharmacyAmount || 0),
    totalPrice: Number(totals._sum.totalPrice || 0),
    totalOrders: totals._count.id,
    uniqueCustomers: uniqueCustomers.length,
    returningCustomers: returningCustomers.length,
    statusGroups,
    topMeds,
    dailyRevenue,
  };
}

async function getInventoryHealth(pharmacyId) {
  // Mirrors mobile computeInventoryHealth: low = 0 < stock < 10, out = stock = 0, value = Σ stock × price
  const rows = await prisma.medicationAvailability.findMany({
    where: { pharmacyId },
    select: { stock: true, price: true },
  });

  let lowStock = 0;
  let outOfStock = 0;
  let totalValue = 0;
  for (const r of rows) {
    const stock = r.stock ?? 0;
    if (stock === 0) outOfStock += 1;
    else if (stock < 10) lowStock += 1;
    totalValue += stock * (r.price ?? 0);
  }

  return { totalItems: rows.length, lowStock, outOfStock, totalValue };
}

module.exports = { getOrderAnalytics, getInventoryHealth };