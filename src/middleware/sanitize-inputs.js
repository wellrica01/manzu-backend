/**
 * XSS PROTECTION - INPUT SANITIZATION MIDDLEWARE
 * 
 * Sanitizes ALL user inputs to prevent XSS attacks
 * Applies to: req.body, req.query, req.params
 */

const DOMPurify = require('isomorphic-dompurify');
const validator = require('validator');
const xss = require('xss');

/**
 * XSS Filter Configuration
 */
const xssOptions = {
  whiteList: {}, // No HTML tags allowed
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style']
};

/**
 * Fields that should preserve newlines (textarea fields)
 */
const PRESERVE_NEWLINES = [
  'notes',
  'specialInstructions',
  'description',
  'address',
  'deliveryInstructions',
  'prescriptionNotes',
  'adminNotes'
];

/**
 * Fields that should be validated as emails
 */
const EMAIL_FIELDS = [
  'email',
  'contactEmail',
  'pharmacyEmail',
  'userEmail'
];

/**
 * Fields that should be validated as phone numbers
 */
const PHONE_FIELDS = [
  'phone',
  'phoneNumber',
  'contactPhone',
  'pharmacyPhone'
];

/**
 * Dangerous patterns to detect and block
 */
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi, // onclick, onerror, etc.
  /data:text\/html/gi,
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
  /<link/gi,
  /<meta/gi,
  /vbscript:/gi,
  /file:/gi,
  /<!--/g,
  /-->/g
];

/**
 * Sanitize a single string value
 */
function sanitizeString(value, fieldName = '') {
  if (typeof value !== 'string') {
    return value;
  }

  // Trim whitespace
  let sanitized = value.trim();

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      console.warn(`🚨 XSS attempt detected in field "${fieldName}":`, sanitized.substring(0, 100));
      
      // Report to Sentry
      if (global.Sentry) {
        global.Sentry.captureMessage('XSS attempt detected', {
          level: 'warning',
          tags: { type: 'xss_attempt' },
          extra: {
            field: fieldName,
            value: sanitized.substring(0, 200),
            pattern: pattern.toString()
          }
        });
      }
    }
  }

  // Email validation
  if (EMAIL_FIELDS.includes(fieldName)) {
    if (sanitized && !validator.isEmail(sanitized)) {
      console.warn(`⚠️  Invalid email in field "${fieldName}":`, sanitized);
      // Don't sanitize further, let validation layer handle it
      return sanitized;
    }
    // Normalize email
    return validator.normalizeEmail(sanitized) || sanitized;
  }

  // Phone validation
  if (PHONE_FIELDS.includes(fieldName)) {
    // Remove non-numeric characters except +
    sanitized = sanitized.replace(/[^\d+]/g, '');
    return sanitized;
  }

  // Use DOMPurify to strip all HTML
  sanitized = DOMPurify.sanitize(sanitized, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });

  // Additional XSS filtering
  sanitized = xss(sanitized, xssOptions);

  // Remove dangerous protocols (before encoding to catch them)
  sanitized = sanitized
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/file:/gi, '');

  // Encode dangerous characters (encode & first to avoid double encoding)
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  // Preserve newlines for textarea fields
  if (PRESERVE_NEWLINES.includes(fieldName)) {
    // Newlines are already preserved, just ensure no HTML
    return sanitized;
  }

  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Limit length to prevent DoS
  const MAX_LENGTH = 10000;
  if (sanitized.length > MAX_LENGTH) {
    console.warn(`⚠️  Field "${fieldName}" exceeds max length (${sanitized.length} > ${MAX_LENGTH})`);
    sanitized = sanitized.substring(0, MAX_LENGTH);
  }

  return sanitized;
}

/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj, parentKey = '') {
  // 1️⃣ Base cases
  if (obj === null || obj === undefined) return obj;

  // 2️⃣ Arrays → sanitize each element recursively
  if (Array.isArray(obj)) {
    return obj.map((item, index) =>
      sanitizeObject(item, `${parentKey}[${index}]`)
    );
  }

  // 3️⃣ Buffers / Dates / RegExps / special objects → return as-is
  if (
    Buffer.isBuffer(obj) ||
    obj instanceof Date ||
    obj instanceof RegExp ||
    obj instanceof Map ||
    obj instanceof Set
  ) {
    return obj;
  }

  // 4️⃣ Plain objects (safe iteration)
  if (typeof obj === 'object') {
    const sanitized = {};
    // Defensive: use Object.prototype.hasOwnProperty.call to handle no-prototype objects
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        sanitized[key] = sanitizeObject(obj[key], fullKey);
      }
    }
    return sanitized;
  }

  // 5️⃣ Strings → sanitize string content
  if (typeof obj === 'string') {
    return sanitizeString(obj, parentKey);
  }

  // 6️⃣ Other primitives (numbers, booleans, etc.) → return as-is
  return obj;
}


/**
 * Sanitization middleware
 */
function sanitizeInputs(req, res, next) {
  try {
    const startTime = Date.now();

    // Sanitize request body
    if (req.body && Object.keys(req.body).length > 0) {
      req.body = sanitizeObject(req.body, 'body');
    }

    // Sanitize query parameters
    if (req.query && Object.keys(req.query).length > 0) {
      req.query = sanitizeObject(req.query, 'query');
    }

    // Sanitize URL parameters
    if (req.params && Object.keys(req.params).length > 0) {
      req.params = sanitizeObject(req.params, 'params');
    }

    const duration = Date.now() - startTime;
    
    // Log slow sanitization (potential DoS)
    if (duration > 100) {
      console.warn(`⚠️  Slow sanitization: ${duration}ms for ${req.method} ${req.path}`);
    }

    next();
  } catch (error) {
    console.error('❌ Sanitization error:', error);
    
    // Report to Sentry
    if (global.Sentry) {
      global.Sentry.captureException(error, {
        tags: { type: 'sanitization_error' },
        extra: {
          method: req.method,
          path: req.path,
          body: req.body,
          query: req.query
        }
      });
    }

    // Continue anyway (don't block request)
    next();
  }
}

/**
 * Encode output for safe HTML display
 */
function encodeForHTML(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate that a string is safe (no XSS)
 */
function isSafeString(value) {
  if (typeof value !== 'string') {
    return true;
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      return false;
    }
  }

  return true;
}

module.exports = {
  sanitizeInputs,
  sanitizeString,
  sanitizeObject,
  encodeForHTML,
  isSafeString,
  DANGEROUS_PATTERNS
};
