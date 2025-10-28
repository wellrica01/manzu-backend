const Joi = require('joi');


const DOSAGE_FREQUENCY = [
  'ONCE_DAILY',
  'TWICE_DAILY',
  'THREE_TIMES_DAILY',
  'FOUR_TIMES_DAILY',
  'EVERY_4_HOURS',
  'EVERY_6_HOURS',
  'EVERY_8_HOURS',
  'EVERY_12_HOURS',
  'AT_BEDTIME',
  'AS_NEEDED',
  'WEEKLY',
  'CUSTOM'
];

const DOSAGE_TIMING = [
  'BEFORE_MEALS',
  'AFTER_MEALS',
  'WITH_FOOD',
  'ON_EMPTY_STOMACH',
  'MORNING',
  'EVENING',
  'ANYTIME'
];

const DURATION_TYPE = [
  'DAYS',
  'WEEKS',
  'MONTHS',
  'UNTIL_FINISHED',
  'ONGOING'
];


function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^+\d]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+234' + cleaned.slice(1);
  } else if (cleaned.startsWith('234')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function isValidPhone(phone) {
  const basicFormat = /^(?:\+?234[0-9]{10}|0[0-9]{10})$/;
  if (!basicFormat.test(phone)) return false;
  const normalized = normalizePhone(phone);
  return /^\+234[0-9]{10}$/.test(normalized);
}

function isValidOrderReference(reference) {
  return typeof reference === 'string' && 
         (reference.startsWith('order_') || 
          reference.startsWith('session_') || 
          reference.startsWith('test_txn_') || 
          reference.startsWith('test_ref_')) && 
         reference.length > 10;
}

function isValidBookingReference(reference) {
  return typeof reference === 'string' && reference.startsWith('booking_') && reference.length > 10;
}

function isValidTrackingCode(trackingCode) {
  return /^TRK-[A-Z0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]{3}$/.test(trackingCode);
}

function validateAddToCart(data) {
  const schema = Joi.object({
    medicationId: Joi.number().integer().required(),
    pharmacyId: Joi.number().integer().required(),
    quantity: Joi.number().integer().min(1).required(),
    userId: Joi.string().optional(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateBulkAddToCart(data) {
  const schema = Joi.object({
    userIdentifier: Joi.string().optional(),
    guestId: Joi.string().uuid().optional(),
    items: Joi.array()
      .items(
        Joi.object({
          medicationId: Joi.number().required(),
          pharmacyId: Joi.number().required(),
          quantity: Joi.number().min(1).required(),
        })
      )
      .min(1)
      .required(),
    prescriptionId: Joi.number().required(),
  }).or('userIdentifier', 'guestId');
  return schema.validate(data);
};

function validateUpdateCart(data) {
  const schema = Joi.object({
    orderItemId: Joi.number().integer().required(),
    quantity: Joi.number().integer().min(1).required(),
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateRemoveFromCart(data) {
  const schema = Joi.object({
    orderItemId: Joi.number().integer().required(),
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateBulkRemoveFromCart(data) {
  const schema = Joi.object({
    orderItemIds: Joi.array()
      .items(Joi.number().integer().required())
      .min(1)
      .required(),
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}


function validateCheckout(data) {
  const schema = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().custom((value, helpers) => {
      if (value && !isValidEmail(value)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'email validation').optional().allow(''),
    phone: Joi.string().custom((value, helpers) => {
      if (!isValidPhone(value)) {
        return helpers.error('any.invalid', { message: 'Invalid phone number format (e.g., 09031615501 or +2349031615501)' });
      }
      return value;
    }, 'phone validation').required(),
    address: Joi.string().when('deliveryMethod', {
      is: 'COURIER',
      then: Joi.string().required(),
      otherwise: Joi.string().allow(null, ''),
    }),
    deliveryMethod: Joi.string().valid('PICKUP', 'COURIER', 'UNSPECIFIED').required(),
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validatePrescriptionRetrieve(data) {
  const schema = Joi.object({
    email: Joi.string().custom((value, helpers) => {
      if (value && !isValidEmail(value)) {
        return helpers.error('any.invalid', { message: 'Invalid email format' });
      }
      return value;
    }, 'email validation').optional(),

    phone: Joi.string().custom((value, helpers) => {
      if (value && !isValidPhone(value)) {
        return helpers.error('any.invalid', { message: 'Invalid phone number format' });
      }
      return value;
    }, 'phone validation').optional(),
  }).or('email', 'phone'); // At least one required

  return schema.validate(data, { abortEarly: false });
}


function validateOrderConfirmation(data) {
  const schema = Joi.object({
    reference: Joi.string().custom((value, helpers) => {
      if (value && !isValidOrderReference(value)) {
        return helpers.error('any.invalid', { message: 'Invalid payment reference format' });
      }
      return value;
    }, 'reference validation').optional(),
    session: Joi.string().required(),
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateTracking(data) {
  const schema = Joi.object({
    trackingCode: Joi.string().custom((value, helpers) => {
      if (!isValidTrackingCode(value)) {
        return helpers.error('any.invalid', { message: 'Invalid tracking code format' });
      }
      return value;
    }, 'tracking code validation').required(),
  });
  return schema.validate(data, { abortEarly: false });
}


function validateConsent(data) {
  const schema = Joi.object({
    userIdentifier: Joi.string().optional(),
    userId: Joi.number().optional(),
    consentType: Joi.string().valid('TERMS', 'PRIVACY', 'MARKETING', 'DATA_SHARING', 'REGULATORY').required(),
    granted: Joi.boolean().required(),
  }).or('userIdentifier', 'userId');
  return schema.validate(data, { abortEarly: false });
}

function validateMedications(data) {
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}

function validateMedicationSuggestions(data) {
  const schema = Joi.object({
    q: Joi.string().trim().min(1).optional(), 
  });
  return schema.validate(data, { abortEarly: false });
}

function validateMedicationSearch(data) {
  const schema = Joi.object({
    q: Joi.string().trim().max(100).optional().custom((value, helpers) => {
      // Remove NULL bytes which cause PostgreSQL errors
      if (value && value.includes('\0')) {
        return value.replace(/\0/g, '');
      }
      return value;
    }),
    medicationId: Joi.number().integer().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    radius: Joi.number().min(1).max(500).default(50),
    state: Joi.string().trim().max(50).optional().custom((value, helpers) => {
      if (value && value.includes('\0')) return value.replace(/\0/g, '');
      return value;
    }),
    lga: Joi.string().trim().max(50).optional().custom((value, helpers) => {
      if (value && value.includes('\0')) return value.replace(/\0/g, '');
      return value;
    }),
    ward: Joi.string().trim().max(50).optional().custom((value, helpers) => {
      if (value && value.includes('\0')) return value.replace(/\0/g, '');
      return value;
    }),
    sortBy: Joi.string().valid('cheapest', 'nearest').default('cheapest')
  }).or('q', 'medicationId');
  return schema.validate(data, { abortEarly: false });
}


function validatePrescriptionUpload(data) {
  const schema = Joi.object({
    userIdentifier: Joi.string().required(),
    contact: Joi.string().required().custom((value, helpers) => {
      if (!isValidEmail(value) && !isValidPhone(value)) {
        return helpers.error('any.invalid', { message: 'Invalid email or phone number format (e.g., example@domain.com or +2349031615501)' });
      }
      return value;
    }, 'contact validation'),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateAddMedications(data) {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    medications: Joi.array().items(
      Joi.object({
        medicationId: Joi.number().integer().required(),
        quantity: Joi.number().integer().min(1).required(),
        dosageAmount: Joi.string().optional().allow(null, ''),
        dosageFrequency: Joi.string().valid(...DOSAGE_FREQUENCY).optional().allow(null),
        dosageTiming: Joi.string().valid(...DOSAGE_TIMING).optional().allow(null),
        durationValue: Joi.number().integer().min(1).optional().allow(null),
        durationType: Joi.string().valid(...DURATION_TYPE).optional().allow(null),
        additionalNotes: Joi.string().optional().allow(null, ''),
      })
    ).min(1).required(),
  });
  return schema.validate(data, { abortEarly: false });
}


function validateDeleteSingle(data) {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    prescriptionMedicationId: Joi.number().integer().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateDeleteBulk(data) {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    prescriptionMedicationIds: Joi.array().items(Joi.number().integer().required()).min(1).required(),
  });
  return schema.validate(data, { abortEarly: false });
}


function validateVerifyPrescription(data) {
  const schema = Joi.object({
    id: Joi.string().pattern(/^[0-9]+$/).required(),
    status: Joi.string().valid('VERIFIED', 'REJECTED', 'EXPIRED', 'PENDING').required(),
    rejectionReason: Joi.string().when('status', {
      is: 'REJECTED',
      then: Joi.required(),
      otherwise: Joi.optional()
    })
  });
  return schema.validate(data, { abortEarly: false });
}

// Rename validateGuestOrder to validatePrescriptionOrder
function validatePrescriptionOrder(data) {
  const schema = Joi.object({
    userIdentifier: Joi.string().required(),
    lat: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    lng: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    radius: Joi.string().pattern(/^\d+(\.\d+)?$/).default('10'),
  });
  return schema.validate(data, { abortEarly: false });
}


function validateFetchOrders(data) {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().allow('').optional(),
    status: Joi.string().valid('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED', 'COMPLETED').optional(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
    deliveryMethod: Joi.string().valid('PICKUP', 'COURIER').optional(),
  });
  return schema.validate(data, { abortEarly: false, convert: true });
}

function validateUpdateOrder(data) {
  const schema = Joi.object({
    orderId: Joi.string().pattern(/^[0-9]+$/).required(),
    status: Joi.string().valid('PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED', 'COMPLETED').required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateBulkUpdateOrders(data) {
  const schema = Joi.object({
    orderIds: Joi.array()
      .items(Joi.number().integer().positive())
      .min(1)
      .max(50) // Limit to 50 orders at once
      .required(),
    status: Joi.string()
      .valid('PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED', 'COMPLETED')
      .required(),
    cancelReason: Joi.string()
      .when('status', {
        is: 'CANCELLED',
        then: Joi.string().required(),
        otherwise: Joi.string().optional().allow(null, '')
      })
  });
  return schema.validate(data, { abortEarly: false });
}

function validateOrderId(data) {
  const schema = Joi.object({
    orderId: Joi.number().integer().positive().required().messages({
      'number.base': 'Order ID must be a number',
      'number.integer': 'Order ID must be an integer',
      'number.positive': 'Order ID must be positive',
      'any.required': 'Order ID is required'
    })
  });
  return schema.validate(data);
}


function validateFetchMedications(data) {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow('').optional(),
    lowStock: Joi.boolean().optional(),
    outOfStock: Joi.boolean().optional(),
    expiringSoon: Joi.boolean().optional(), // NEW: medications expiring within 30 days
    prescriptionRequired: Joi.string().valid('true', 'false').optional(),
  }).oxor('lowStock', 'outOfStock');

  return schema.validate(data, { abortEarly: false, convert: true });
}


function validateAddMedication(data) {
  const schema = Joi.object({
    medicationId: Joi.number().integer().required(),
    stock: Joi.number().integer().positive().required(),
    price: Joi.number().precision(2).positive().required(),
    batchNumber: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}


function validateUpdateMedication(data) {
  const schema = Joi.object({
    medicationId: Joi.number().integer().required(),
    stock: Joi.number().integer().min(0).required(),
    price: Joi.number().precision(2).min(0).required(),
    receivedDate: Joi.date().optional().allow(null),
    expiryDate: Joi.date().optional().allow(null),
    batchNumber: Joi.string().optional(),
  });
  return schema.validate(data, { abortEarly: false });
}


function validateDeleteMedication(data) {
  const schema = Joi.object({
    medicationId: Joi.string().pattern(/^[0-9]+$/).required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateFetchUsers(data) {
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}

function validateRegisterDevice(data) {
  const schema = Joi.object({
    deviceToken: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}




module.exports = {
  isValidEmail,
  normalizePhone,
  isValidPhone,
  isValidOrderReference,
  isValidBookingReference,
  isValidTrackingCode,
  validateAddToCart,
  validateBulkAddToCart,
  validateUpdateCart,
  validateRemoveFromCart,
  validateBulkRemoveFromCart,
  validateCheckout,
  validatePrescriptionRetrieve,
  validateOrderConfirmation,
  validateTracking,
  validateConsent,
  validateMedications,
  validateMedicationSuggestions,
  validateMedicationSearch,
  validatePrescriptionUpload,
  validateAddMedications,
  validateDeleteSingle,
  validateDeleteBulk,
  validateVerifyPrescription,
  validatePrescriptionOrder,
  validateFetchOrders,
  validateUpdateOrder,
  validateBulkUpdateOrders,
  validateOrderId,
  validateFetchMedications,
  validateAddMedication,
  validateUpdateMedication,
  validateDeleteMedication,
  validateFetchUsers,
  validateRegisterDevice,
};