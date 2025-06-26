const Joi = require('joi');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
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
  return typeof reference === 'string' && reference.startsWith('order_') && reference.length > 10;
}

function isValidBookingReference(reference) {
  return typeof reference === 'string' && reference.startsWith('booking_') && reference.length > 10;
}

function isValidTrackingCode(trackingCode) {
  return /^TRK-SESSION-\d+-\d+$/.test(trackingCode);
}






























function validateServiceSuggestions(data) {
  const schema = Joi.object({
    q: Joi.string().trim().min(1).optional(),
    type: Joi.string().valid('medication', 'diagnostic', 'diagnostic_package').optional(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateServiceSearch(data) {
  const schema = Joi.object({
    q: Joi.string().trim().optional(),
    serviceId: Joi.number().integer().optional(),
    page: Joi.string().pattern(/^\d+$/).default('1'),
    limit: Joi.string().pattern(/^\d+$/).default('10'),
    lat: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    lng: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    radius: Joi.string().pattern(/^\d+(\.\d+)?$/).default('10'),
    state: Joi.string().optional(),
    lga: Joi.string().optional(),
    ward: Joi.string().optional(),
    sortBy: Joi.string().valid('cheapest', 'closest').default('cheapest'),
    homeCollection: Joi.string().valid('true').optional(),
    type: Joi.string().valid('medication', 'diagnostic', 'diagnostic_package').optional(),
  }).or('q', 'serviceId');
  return schema.validate(data, { abortEarly: false });
}



const validateAddToOrder = (data) => Joi.object({
  serviceId: Joi.number().integer().required(),
  providerId: Joi.number().integer().required(),
  quantity: Joi.number().integer().min(1).optional(),
  userId: Joi.string().required(),
  type: Joi.string().valid('medication', 'diagnostic', 'diagnostic_package').required(),
}).validate(data);


function validateRemoveFromOrder(data) {
  const schema = Joi.object({
    orderItemId: Joi.number().integer().required(),
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateGetTimeSlots(data) {
  const schema = Joi.object({
    providerId: Joi.number().integer().required().messages({
      'number.base': 'Provider ID must be a number',
      'number.integer': 'Provider ID must be an integer',
      'any.required': 'Provider ID is required',
    }),
    serviceId: Joi.number().integer().optional().messages({
      'number.base': 'Service ID must be a number',
      'number.integer': 'Service ID must be an integer',
    }),
    fulfillmentType: Joi.string()
      .valid('in_person', 'home_collection')
      .optional()
      .messages({
        'string.valid': 'Fulfillment type must be either "in_person" or "home_collection"',
      }),
    date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .custom((value, helpers) => {
        const inputDate = new Date(value);
        const today = new Date(new Date().setHours(0, 0, 0, 0));
        if (inputDate < today) {
          return helpers.error('date.min');
        }
        return value;
      })
      .messages({
        'string.pattern.base': 'Date must be in YYYY-MM-DD format',
        'date.min': 'Date cannot be in the past',
      }),
  });

  return schema.validate(data, { abortEarly: false });
}


function validateUpdateOrderDetails(data) {
  const schema = Joi.object({
    itemId: Joi.number().integer().required(),
    timeSlotStart: Joi.string().isoDate().optional(),
    fulfillmentType: Joi.string().valid('lab_visit', 'delivery').optional(), // Unified with Order deliveryMethod
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validatePrescriptionUpload(data) {
  const schema = Joi.object({
    patientIdentifier: Joi.string().required(),
    contact: Joi.string().required().custom((value, helpers) => {
      if (!isValidEmail(value) && !isValidPhone(value)) {
        return helpers.error('any.invalid', { message: 'Invalid email or phone number format (e.g., example@domain.com or +2349031615501)' });
      }
      return value;
    }, 'contact validation'),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateAddServices(data) {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    services: Joi.array().items(
      Joi.object({
        serviceId: Joi.number().integer().required(),
        quantity: Joi.number().integer().min(1).default(1), // Default to 1 for diagnostics
      })
    ).min(1).required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateVerifyPrescription(data) {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    status: Joi.string().valid('pending', 'verified', 'rejected').required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateGuestOrder(data) {
  const schema = Joi.object({
    patientIdentifier: Joi.string().required(),
    lat: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    lng: Joi.string().pattern(/^-?\d+(\.\d+)?$/).optional(),
    radius: Joi.string().pattern(/^\d+(\.\d+)?$/).default('10'),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateCheckout(data) {
  const schema = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().custom((value, helpers) => {
      if (!isValidEmail(value)) {
        return helpers.error('any.invalid', { message: 'Invalid email format' });
      }
      return value;
    }, 'email validation').required(),
    phone: Joi.string().custom((value, helpers) => {
      if (!isValidPhone(value)) {
        return helpers.error('any.invalid', { message: 'Invalid phone number format (e.g., 09031615501 or +2349031615501)' });
      }
      return value;
    }, 'phone validation').required(),
    address: Joi.string().when('deliveryMethod', {
      is: 'delivery',
      then: Joi.string().required(),
      otherwise: Joi.string().allow(null, ''),
    }),
    deliveryMethod: Joi.string().valid('delivery', 'pickup', 'lab_visit').required(),
    userId: Joi.string().required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateSessionRetrieve(data) {
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
    checkoutSessionId: Joi.string().optional(),
  }).or('email', 'phone', 'checkoutSessionId');
  return schema.validate(data, { abortEarly: false });
}

function validateResume(data) {
  const schema = Joi.object({
    orderId: Joi.number().integer().required(),
    email: Joi.string().custom((value, helpers) => {
      if (!isValidEmail(value)) {
        return helpers.error('any.invalid', { message: 'Invalid email format' });
      }
      return value;
    }, 'email validation').required(),
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

function validateFetchOrders(data) {
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}

function validateUpdateOrder(data) {
  const schema = Joi.object({
    orderId: Joi.number().integer().required(),
    status: Joi.string().valid('processing', 'shipped', 'delivered', 'ready_for_pickup', 'sample_collected', 'result_ready', 'completed').required(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateFetchServices(data) {
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}

function validateAddService(data) {
  const schema = Joi.object({
    serviceId: Joi.number().integer().required(),
    stock: Joi.number().integer().positive().optional(),
    price: Joi.number().precision(2).positive().required(),
    available: Joi.boolean().optional(),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateUpdateService(data) {
  const schema = Joi.object({
    serviceId: Joi.number().integer().required(),
    stock: Joi.number().integer().min(0).optional(),
    price: Joi.number().min(0).required(),
    available: Joi.boolean().optional(),
    receivedDate: Joi.date().optional().allow(null),
    expiryDate: Joi.date().optional().allow(null),
  });
  return schema.validate(data, { abortEarly: false });
}

function validateDeleteService(data) {
  const schema = Joi.object({
    serviceId: Joi.number().integer().required(),
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
    patientIdentifier: Joi.string().optional(),
    userId: Joi.number().optional(),
    consentType: Joi.string().valid('data_collection', 'marketing').required(),
    granted: Joi.boolean().required(),
  }).or('patientIdentifier', 'userId');
  return schema.validate(data, { abortEarly: false });
}

function validateMedications(data) {
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}


function validateTests(data) {
  const schema = Joi.object({});
  return schema.validate(data, { abortEarly: false });
}










module.exports = {
  isValidEmail,
  normalizePhone,
  isValidPhone,
  isValidOrderReference,
  isValidBookingReference,
  isValidTrackingCode,
  validateConsent,
  validateMedications,
  validateTests,
  validatePrescriptionUpload,
  validateVerifyPrescription,
  validateGuestOrder,
  validateFetchOrders,
  validateUpdateOrder,
  validateFetchUsers,
  validateRegisterDevice,






























  validateServiceSuggestions,
  validateServiceSearch,
  validateAddToOrder,
  validateUpdateOrder,
  validateRemoveFromOrder,
  validateGetTimeSlots,
  validateUpdateOrderDetails,
  validatePrescriptionUpload,
  validateAddServices,
  validateVerifyPrescription,
  validateGuestOrder,
  validateCheckout,
  validateSessionRetrieve,
  validateResume,
  validateOrderConfirmation,
  validateFetchOrders,
  validateUpdateOrder,
  validateFetchServices,
  validateAddService,
  validateUpdateService,
  validateDeleteService,
  validateFetchUsers,
  validateRegisterDevice,
  validateTracking
};