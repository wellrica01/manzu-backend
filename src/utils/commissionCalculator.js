/**
 * COMMISSION & FEE CALCULATOR
 * 
 * Handles all financial calculations for orders:
 * - Platform commission (8% flat)
 * - Paystack collection fees
 * - Paystack transfer fees
 * - Net revenue calculations
 * 
 * Use for: order processing, accounting, reports, analytics
 */

// ============================================
// CONFIGURATION
// ============================================

const COMMISSION_RATE = 0.08; // 8% flat commission

const PAYSTACK_CONFIG = {
  // Collection fee (charged when customer pays)
  collection: {
    rate: 0.015,    // 1.5%
    cap: 2500       // ₦2,500 maximum per transaction
  },
  
  // Transfer fee (charged when we pay pharmacy)
  transfer: {
    tier1: { max: 5000, fee: 10 },      // ₦10 for ≤ ₦5,000
    tier2: { max: 50000, fee: 25 },     // ₦25 for ₦5,001 - ₦50,000
    tier3: { fee: 50 }                  // ₦50 for > ₦50,000
  }
};

// ============================================
// CORE CALCULATION FUNCTIONS
// ============================================

/**
 * Calculate platform commission (8%)
 * @param {number} orderTotal - Total order amount
 * @returns {Object} { platformFee, pharmacyAmount }
 */
function calculateCommission(orderTotal) {
  const platformFee = parseFloat((orderTotal * COMMISSION_RATE).toFixed(2));
  const pharmacyAmount = parseFloat((orderTotal - platformFee).toFixed(2));
  
  return {
    platformFee,
    pharmacyAmount
  };
}

/**
 * Calculate Paystack collection fee (1.5%, capped at ₦2,500)
 * This is deducted when customer pays
 * @param {number} orderTotal - Total order amount
 * @returns {number} Collection fee
 */
function calculateCollectionFee(orderTotal) {
  const fee = orderTotal * PAYSTACK_CONFIG.collection.rate;
  return parseFloat(Math.min(fee, PAYSTACK_CONFIG.collection.cap).toFixed(2));
}

/**
 * Calculate Paystack transfer fee (tiered based on amount)
 * This is charged when we transfer to pharmacy
 * @param {number} transferAmount - Amount being transferred
 * @returns {number} Transfer fee
 */
function calculateTransferFee(transferAmount) {
  if (transferAmount <= PAYSTACK_CONFIG.transfer.tier1.max) {
    return PAYSTACK_CONFIG.transfer.tier1.fee;
  } else if (transferAmount <= PAYSTACK_CONFIG.transfer.tier2.max) {
    return PAYSTACK_CONFIG.transfer.tier2.fee;
  } else {
    return PAYSTACK_CONFIG.transfer.tier3.fee;
  }
}

// ============================================
// COMPLETE ORDER BREAKDOWN
// ============================================

/**
 * Calculate complete financial breakdown for a single order
 * Use this for order confirmation, reports, and analytics
 * 
 * @param {number} orderTotal - Total order amount
 * @returns {Object} Complete financial breakdown
 */
function calculateOrderFinancials(orderTotal) {
  // Step 1: Calculate commission
  const commission = calculateCommission(orderTotal);
  
  // Step 2: Calculate Paystack fees
  const collectionFee = calculateCollectionFee(orderTotal);
  const transferFee = calculateTransferFee(commission.pharmacyAmount);
  
  // Step 3: Calculate net amounts
  const totalPaystackFees = collectionFee + transferFee;
  const amountReceivedFromPaystack = orderTotal - collectionFee;
  const platformNetRevenue = commission.platformFee - totalPaystackFees;
  const platformNetMargin = (platformNetRevenue / orderTotal) * 100;
  
  return {
    // Order details
    orderTotal: parseFloat(orderTotal.toFixed(2)),
    
    // Commission breakdown
    platformCommission: commission.platformFee,
    platformCommissionRate: `${(COMMISSION_RATE * 100).toFixed(1)}%`,
    pharmacyEntitlement: commission.pharmacyAmount,
    pharmacyPercentage: `${((commission.pharmacyAmount / orderTotal) * 100).toFixed(1)}%`,
    
    // Paystack fees
    paystackCollectionFee: collectionFee,
    paystackTransferFee: transferFee,
    totalPaystackFees: parseFloat(totalPaystackFees.toFixed(2)),
    paystackPercentage: `${((totalPaystackFees / orderTotal) * 100).toFixed(2)}%`,
    
    // Net amounts
    amountReceivedFromPaystack: parseFloat(amountReceivedFromPaystack.toFixed(2)),
    pharmacyReceives: commission.pharmacyAmount, // They get full entitlement
    platformNetRevenue: parseFloat(platformNetRevenue.toFixed(2)),
    platformNetMargin: `${platformNetMargin.toFixed(2)}%`,
    
    // Summary
    breakdown: {
      customer: orderTotal,
      paystack: totalPaystackFees,
      platform: platformNetRevenue,
      pharmacy: commission.pharmacyAmount
    }
  };
}

// ============================================
// BATCH CALCULATIONS (FOR SETTLEMENTS)
// ============================================

/**
 * Calculate financials for multiple orders (batch settlement)
 * Use for daily payout processing and batch reports
 * 
 * @param {Array} orders - Array of order objects with totalPrice and pharmacyAmount
 * @returns {Object} Aggregated financial breakdown
 */
function calculateBatchFinancials(orders) {
  let totalOrderValue = 0;
  let totalPlatformCommission = 0;
  let totalPharmacyAmount = 0;
  let totalCollectionFees = 0;
  let totalTransferFees = 0;
  
  const orderBreakdowns = orders.map(order => {
    const breakdown = calculateOrderFinancials(order.totalPrice || order.orderTotal);
    
    totalOrderValue += breakdown.orderTotal;
    totalPlatformCommission += breakdown.platformCommission;
    totalPharmacyAmount += breakdown.pharmacyEntitlement;
    totalCollectionFees += breakdown.paystackCollectionFee;
    totalTransferFees += breakdown.paystackTransferFee;
    
    return {
      orderId: order.id,
      ...breakdown
    };
  });
  
  const totalPaystackFees = totalCollectionFees + totalTransferFees;
  const platformNetRevenue = totalPlatformCommission - totalPaystackFees;
  
  return {
    orderCount: orders.length,
    
    // Totals
    totalOrderValue: parseFloat(totalOrderValue.toFixed(2)),
    totalPlatformCommission: parseFloat(totalPlatformCommission.toFixed(2)),
    totalPharmacyAmount: parseFloat(totalPharmacyAmount.toFixed(2)),
    
    // Paystack fees
    totalCollectionFees: parseFloat(totalCollectionFees.toFixed(2)),
    totalTransferFees: parseFloat(totalTransferFees.toFixed(2)),
    totalPaystackFees: parseFloat(totalPaystackFees.toFixed(2)),
    
    // Net revenue
    platformNetRevenue: parseFloat(platformNetRevenue.toFixed(2)),
    platformNetMargin: `${((platformNetRevenue / totalOrderValue) * 100).toFixed(2)}%`,
    
    // Averages
    averageOrderValue: parseFloat((totalOrderValue / orders.length).toFixed(2)),
    averageCommission: parseFloat((totalPlatformCommission / orders.length).toFixed(2)),
    averageNetRevenue: parseFloat((platformNetRevenue / orders.length).toFixed(2)),
    
    // Individual breakdowns
    orders: orderBreakdowns
  };
}

// ============================================
// GROUP BY PHARMACY (FOR SETTLEMENTS)
// ============================================

/**
 * Calculate financials grouped by pharmacy
 * Use for daily settlement processing
 * 
 * @param {Array} orders - Array of orders with pharmacyId
 * @returns {Array} Array of pharmacy financial summaries
 */
function calculatePharmacySettlements(orders) {
  // Group by pharmacy
  const pharmacyGroups = orders.reduce((acc, order) => {
    const pharmacyId = order.pharmacyId || order.Pharmacy?.id;
    
    if (!pharmacyId) return acc;
    
    if (!acc[pharmacyId]) {
      acc[pharmacyId] = {
        pharmacyId,
        pharmacyName: order.Pharmacy?.name || order.pharmacyName || 'Unknown',
        orders: []
      };
    }
    
    acc[pharmacyId].orders.push(order);
    return acc;
  }, {});
  
  // Calculate financials for each pharmacy
  return Object.values(pharmacyGroups).map(group => {
    const batchFinancials = calculateBatchFinancials(group.orders);
    
    return {
      pharmacyId: group.pharmacyId,
      pharmacyName: group.pharmacyName,
      orderCount: batchFinancials.orderCount,
      totalOrderValue: batchFinancials.totalOrderValue,
      
      // What pharmacy gets
      pharmacySettlementAmount: batchFinancials.totalPharmacyAmount,
      transferFee: batchFinancials.totalTransferFees,
      
      // Platform earnings from this pharmacy
      platformCommission: batchFinancials.totalPlatformCommission,
      platformNetRevenue: batchFinancials.platformNetRevenue,
      
      // Details
      orders: batchFinancials.orders
    };
  });
}

// ============================================
// REPORTING & ANALYTICS
// ============================================

/**
 * Generate financial summary report
 * Use for dashboards, reports, and analytics
 * 
 * @param {Array} orders - Array of orders
 * @param {Object} options - Report options
 * @returns {Object} Financial summary
 */
function generateFinancialReport(orders, options = {}) {
  const { groupBy = null } = options;
  
  if (groupBy === 'pharmacy') {
    return calculatePharmacySettlements(orders);
  }
  
  return calculateBatchFinancials(orders);
}

/**
 * Calculate projected revenue for given order volume
 * Use for forecasting and planning
 * 
 * @param {number} orderCount - Expected number of orders
 * @param {number} averageOrderValue - Expected average order value
 * @returns {Object} Revenue projection
 */
function projectRevenue(orderCount, averageOrderValue) {
  const totalGMV = orderCount * averageOrderValue;
  const singleOrderFinancials = calculateOrderFinancials(averageOrderValue);
  
  return {
    orderCount,
    averageOrderValue,
    projectedGMV: parseFloat((totalGMV).toFixed(2)),
    
    // Platform revenue
    grossCommission: parseFloat((singleOrderFinancials.platformCommission * orderCount).toFixed(2)),
    estimatedPaystackFees: parseFloat((singleOrderFinancials.totalPaystackFees * orderCount).toFixed(2)),
    netRevenue: parseFloat((singleOrderFinancials.platformNetRevenue * orderCount).toFixed(2)),
    netMargin: singleOrderFinancials.platformNetMargin,
    
    // Pharmacy revenue
    pharmacyRevenue: parseFloat((singleOrderFinancials.pharmacyEntitlement * orderCount).toFixed(2)),
    
    // Monthly/Annual projections
    monthly: {
      orders: orderCount,
      gmv: parseFloat((totalGMV).toFixed(2)),
      netRevenue: parseFloat((singleOrderFinancials.platformNetRevenue * orderCount).toFixed(2))
    },
    annual: {
      orders: orderCount * 12,
      gmv: parseFloat((totalGMV * 12).toFixed(2)),
      netRevenue: parseFloat((singleOrderFinancials.platformNetRevenue * orderCount * 12).toFixed(2))
    }
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format currency for display
 * @param {number} amount - Amount in Naira
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  return `₦${amount.toLocaleString('en-NG', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}

/**
 * Validate commission calculation
 * @param {number} orderTotal - Order total
 * @param {number} platformFee - Calculated platform fee
 * @returns {boolean} True if valid
 */
function validateCommission(orderTotal, platformFee) {
  const expected = calculateCommission(orderTotal).platformFee;
  return Math.abs(platformFee - expected) < 0.01; // Allow 1 kobo tolerance
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Core calculations
  calculateCommission,
  calculateCollectionFee,
  calculateTransferFee,
  calculateOrderFinancials,
  
  // Batch calculations
  calculateBatchFinancials,
  calculatePharmacySettlements,
  
  // Reporting
  generateFinancialReport,
  projectRevenue,
  
  // Utilities
  formatCurrency,
  validateCommission,
  
  // Constants (for reference)
  COMMISSION_RATE,
  PAYSTACK_CONFIG
};