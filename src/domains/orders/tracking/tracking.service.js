/**
 * TRACKING SERVICE
 * 
 * Business logic for order tracking
 * Refactored to use repository pattern
 */

const trackingRepository = require('./tracking.repository');
const {
  capitalize,
  formatPerUnitType,
  formatPackSizeUnit,
  formatStrengthUnit,
} = require('../../../utils/medicationUtils');

/**
 * Track orders by tracking code
 * 
 * @param {string} trackingCode - Order tracking code
 * @returns {Promise<Object>} Formatted order tracking data
 * @throws {Error} If orders not found
 */
async function trackOrders(trackingCode) {
  console.log('Searching for orders by tracking code:', { trackingCode });

  const orders = await trackingRepository.findOrdersByTrackingCode(trackingCode);

  if (!orders.length) {
    throw new Error('Orders not found or not ready for tracking');
  }

  console.log('Orders found:', { orderIds: orders.map(o => o.id), trackingCode });

  return {
    message: 'Orders found',
    orders: orders.map(order => formatOrderForTracking(order)),
  };
}

/**
 * Format order data for tracking response
 * 
 * @param {Object} order - Raw order from database
 * @returns {Object} Formatted order data
 */
function formatOrderForTracking(order) {
  // Extract latest refund
  const latestRefund =
    order.Refund && order.Refund.length
      ? order.Refund.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
      : null;

  return {
    id: order.id,
    name: order.name,
    userIdentifier: order.userIdentifier,
    totalPrice: order.totalPrice,
    address: order.address,
    deliveryMethod: order.deliveryMethod,
    trackingCode: order.trackingCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    filledAt: order.filledAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,

    // Refund information
    refundStatus: latestRefund?.status || null,
    refundAmount: latestRefund?.amount ? parseFloat(latestRefund.amount) : null,
    refundDate: latestRefund?.processedAt || null,
    rejectionReason: order.cancelReason || latestRefund?.reason || null,

    // Prescription info
    prescription: order.Prescription ? formatPrescription(order.Prescription) : null,

    // Pharmacy info
    pharmacy: order.Pharmacy
      ? {
          id: order.Pharmacy.id,
          name: order.Pharmacy.name,
          address: order.Pharmacy.address,
        }
      : null,

    // Order items
    items: order.OrderItem.map(item => formatOrderItem(item)),
  };
}

/**
 * Format prescription data
 * 
 * @param {Object} prescription - Raw prescription from database
 * @returns {Object} Formatted prescription data
 */
function formatPrescription(prescription) {
  return {
    id: prescription.id,
    status: prescription.status,
    fileUrl: prescription.fileUrl,
    verified: prescription.status === 'VERIFIED',
    medications: prescription.PrescriptionMedication.map(pm => {
      const med = pm.Medication;
      const ingredients = formatIngredients(med.Medication_MedicationIngredient);

      const displayName = med.form
        ? `${med.brandName}${med.pharmacopeia ? ` ${med.pharmacopeia}` : ''} (${capitalize(med.form)})`
        : med.brandName;

      return {
        medicationId: pm.medicationId,
        ingredients,
        displayName,
        quantity: pm.quantity,
      };
    }),
  };
}

/**
 * Format order item data
 * 
 * @param {Object} item - Raw order item from database
 * @returns {Object} Formatted order item data
 */
function formatOrderItem(item) {
  const med = item.MedicationAvailability?.Medication;
  const ingredients = med ? formatIngredients(med.Medication_MedicationIngredient) : [];

  const displayName = med
    ? med.form
      ? `${med.brandName}${med.pharmacopeia ? ` ${med.pharmacopeia}` : ''} (${capitalize(med.form)})`
      : med.brandName
    : null;

  return {
    id: item.id,
    medication: med
      ? {
          id: med.id,
          brandName: med.brandName,
          prescriptionRequired: med.prescriptionRequired,
          packSizeUnit: formatPackSizeUnit(med.packSizeUnit),
          ingredients,
          displayName,
        }
      : null,
    pharmacy: item.MedicationAvailability?.Pharmacy
      ? {
          name: item.MedicationAvailability.Pharmacy.name,
          address: item.MedicationAvailability.Pharmacy.address,
        }
      : null,
    quantity: item.quantity,
    price: item.price,
    expiryDate: item.MedicationAvailability?.expiryDate,
  };
}

/**
 * Format medication ingredients
 * 
 * @param {Array} medicationIngredients - Raw medication ingredients
 * @returns {Array} Formatted ingredients
 */
function formatIngredients(medicationIngredients) {
  return medicationIngredients.map(mmi => {
    const ingredient = mmi.MedicationIngredient;
    return {
      activeSubstance: ingredient.ActiveSubstance?.name || null,
      strengthValue: ingredient.strengthValue || null,
      strengthUnit: formatStrengthUnit(ingredient.strengthUnit),
      perUnitValue: ingredient.perUnitValue || null,
      perUnitType: formatPerUnitType(ingredient.perUnitType),
    };
  });
}

module.exports = {
  trackOrders,
};