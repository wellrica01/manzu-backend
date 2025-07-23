const Joi = require('joi');

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
  return typeof reference === 'string' && (reference.startsWith('order_') || reference.startsWith('session_')) && reference.length > 10;
}

function isValidBookingReference(reference) {
  return typeof reference === 'string' && reference.startsWith('booking_') && reference.length > 10;
}

function isValidTrackingCode(trackingCode) {
  return /^TRK-SESSION-\d+-\d+$/.test(trackingCode);
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

function validateSessionRetrieve(data) {
  const schema = Joi.object({
    email: Joi.string().custom((value, helpers) => {
      if (value && !isValidEmail(value)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'email validation').optional(),
    phone: Joi.string().custom((value, helpers) => {
      if (value && !isValidPhone(value)) {
        return helpers.error('any.invalid', { message: 'Invalid phone number format' });
      }
      return value;
    }, 'phone validation').optional(),
    checkoutSessionId: Joi.string().optional(),
  }).or('email', 'phone', 'checkoutSessionId');
  return schema.validate(data, { abortEarly: false });
}

function validateResume(data) {
  const schema = Joi.object({
    orderId: Joi.number().integer().required(),
    email: Joi.string().custom((value, helpers) => {
      if (value && !isValidEmail(value)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'email validation').optional().allow(''),
    userId: Joi.string().required(),
  });
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
    q: Joi.string().trim().optional(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateMedicationSearch(data) {
  const schema = Joi.object({
    q: Joi.string().trim().optional(),
    medicationId: Joi.number().integer().optional(),
    page: Joi.string().pattern(/^\d+$/).default('1'),
    limit: Joi.string().pattern(/^\d+$/).default('10'),
    lat: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    lng: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    radius: Joi.string().pattern(/^\d+(\.\d+)?$/).default('10'),
    state: Joi.string().optional(),
    lga: Joi.string().optional(),
    ward: Joi.string().optional(),
    sortBy: Joi.string().valid('cheapest', 'closest').default('cheapest'),
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
        dosageInstructions: Joi.string().optional().allow(null, ''),
      })
    ).min(1).required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateVerifyPrescription(data) {
  const schema = Joi.object({
    id: Joi.string().pattern(/^[0-9]+$/).required(),
    status: Joi.string().valid('VERIFIED', 'REJECTED', 'EXPIRED', 'PENDING').required(),
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
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}

function validateUpdateOrder(data) {
  const schema = Joi.object({
    orderId: Joi.string().pattern(/^[0-9]+$/).required(),
    status: Joi.string().valid('PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP').required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateFetchMedications(data) {
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}

function validateAddMedication(data) {
  const schema = Joi.object({
    medicationId: Joi.number().integer().required(),
    stock: Joi.number().integer().positive().required(),
    price: Joi.number().precision(2).positive().required(),
  });
  return schema.validate(data, { abortEarly: false });
}



function validateUpdateMedication(data) {
  const schema = Joi.object({
    medicationId: Joi.number().integer().required(),
    stock: Joi.number().integer().min(0).required(),
    price: Joi.number().min(0).required(),
    receivedDate: Joi.date().optional().allow(null),
    expiryDate: Joi.date().optional().allow(null),
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
  validateUpdateCart,
  validateRemoveFromCart,
  validateCheckout,
  validateSessionRetrieve,
  validateResume,
  validateOrderConfirmation,
  validateTracking,
  validateConsent,
  validateMedications,
  validateMedicationSuggestions,
  validateMedicationSearch,
  validatePrescriptionUpload,
  validateAddMedications,
  validateVerifyPrescription,
  validatePrescriptionOrder,
  validateFetchOrders,
  validateUpdateOrder,
  validateFetchMedications,
  validateAddMedication,
  validateUpdateMedication,
  validateDeleteMedication,
  validateFetchUsers,
  validateRegisterDevice,
};