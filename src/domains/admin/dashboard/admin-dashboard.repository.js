/**
 * ADMIN DASHBOARD REPOSITORY
 * 
 * Database access layer for admin dashboard metrics
 */

const prisma = require('../../../core/database/prisma');

/**
 * Get comprehensive dashboard metrics in a single transaction
 */
async function getDashboardMetrics(thirtyDaysAgo, sevenDaysAgo, sixtyDaysAgo) {
  return await prisma.$transaction([
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
      where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }
    }),
    prisma.pharmacy.count({
      where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }
    }),
    prisma.order.count({
      where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }
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
}

module.exports = {
  getDashboardMetrics,
};