/**
 * PHARMACY PAYOUTS REPOSITORY
 * 
 * Database access layer for payout operations
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find orders ready for payout (COMPLETED + PENDING payout)
 */
async function findOrdersReadyForPayout(pharmacyId = null) {
  const where = {
    status: 'COMPLETED',
    payoutStatus: 'PENDING',
    paymentStatus: 'PAID',
  };

  if (pharmacyId !== null && pharmacyId !== undefined) {
    where.pharmacyId = Number(pharmacyId); 
  }

  return await prisma.order.findMany({
    where,
    include: {
      Pharmacy: {
        select: {
          id: true,
          name: true,
          recipientCode: true,
        },
      },
    },
    orderBy: { filledAt: 'asc' },
  });
}

/**
 * Group orders by pharmacy for batch processing
 */
async function groupOrdersByPharmacy() {
  const orders = await findOrdersReadyForPayout();
  
  const grouped = orders.reduce((acc, order) => {
    const pharmacyId = order.pharmacyId;
    
    if (!acc[pharmacyId]) {
      acc[pharmacyId] = {
        pharmacy: order.Pharmacy,
        orders: [],
        totalAmount: 0,
      };
    }
    
    acc[pharmacyId].orders.push(order);
    acc[pharmacyId].totalAmount += order.pharmacyAmount || 0;
    
    return acc;
  }, {});

  return Object.values(grouped);
}

/**
 * Create payout record
 */
async function createPayout(data, tx = null) {
  const client = tx || prisma;
  
  return await client.payout.create({
    data: {
      pharmacyId: data.pharmacyId,
      amount: data.amount,
      orderIds: data.orderIds,
      status: 'PENDING',
      reference: data.reference,
    },
  });
}

/**
 * Update payout status
 */
async function updatePayoutStatus(payoutId, status, data = {}, tx = null) {
  const client = tx || prisma;
  
  return await client.payout.update({
    where: { id: payoutId },
    data: {
      status,
      ...data,
    },
  });
}

/**
 * Update orders payout status
 */
async function updateOrdersPayoutStatus(orderIds, status, data = {}, tx = null) {
  const client = tx || prisma;
  
  return await client.order.updateMany({
    where: {
      id: { in: orderIds },
    },
    data: {
      payoutStatus: status,
      ...data,
    },
  });
}

/**
 * Find payout by reference
 */
async function findPayoutByReference(reference) {
  return await prisma.payout.findUnique({
    where: { reference },
    include: {
      Pharmacy: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  });
}

/**
 * Get payout summary for pharmacy
 */
async function getPayoutSummary(pharmacyId) {
  const [pending, processing, completed, failed, pharmacy] = await Promise.all([
    prisma.order.aggregate({
      where: {
        pharmacyId,
        status: 'COMPLETED',
        payoutStatus: 'PENDING',
      },
      _sum: { pharmacyAmount: true },
      _count: true,
    }),
    prisma.payout.aggregate({
      where: {
        pharmacyId,
        status: 'PROCESSING',
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.payout.aggregate({
      where: {
        pharmacyId,
        status: 'COMPLETED',
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.payout.aggregate({
      where: {
        pharmacyId,
        status: 'FAILED',
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true, recipientCode: true },
    }),
  ]);

  return {
    pending: {
      amount: pending._sum.pharmacyAmount || 0,
      count: pending._count || 0,
    },
    processing: {
      amount: processing._sum.amount || 0,
      count: processing._count || 0,
    },
    completed: {
      amount: completed._sum.amount || 0,
      count: completed._count || 0,
    },
    failed: {
      amount: failed._sum.amount || 0,
      count: failed._count || 0,
    },
    bankingConfigured: Boolean(pharmacy?.recipientCode),
  };
}


/**
 * Get payout history for pharmacy
 */
async function getPayoutHistory(pharmacyId, { page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where: { pharmacyId },
      orderBy: { initiatedAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.payout.count({
      where: { pharmacyId },
    }),
  ]);

  return {
    payouts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get failed payouts requiring retry
 */
async function getFailedPayouts() {
  return await prisma.payout.findMany({
    where: {
      status: 'FAILED',
    },
    include: {
      Pharmacy: {
        select: {
          id: true,
          name: true,
          recipientCode: true,
        },
      },
    },
    orderBy: { initiatedAt: 'asc' },
  });
}

module.exports = {
  findOrdersReadyForPayout,
  groupOrdersByPharmacy,
  createPayout,
  updatePayoutStatus,
  updateOrdersPayoutStatus,
  findPayoutByReference,
  getPayoutSummary,
  getPayoutHistory,
  getFailedPayouts,
};