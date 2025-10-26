/**
 * CONSOLIDATED INPUT SANITIZATION MIDDLEWARE
 * 
 * Combines SQL injection protection and XSS protection
 * Defense-in-depth approach with multiple sanitization layers
 */

const DOMPurify = require('isomorphic-dompurify');
const validator = require('validator');
const xss = require('xss');

// ==================== XSS CONFIGURATION ====================

const xssOptions = {
  whiteList: {}, // No HTML tags allowed
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style']
};

const PRESERVE_NEWLINES = [
  'notes', 'specialInstructions', 'description', 'address',
  'deliveryInstructions', 'prescriptionNotes', 'adminNotes'
];

const EMAIL_FIELDS = [
  'email', 'contactEmail', 'pharmacyEmail', 'userEmail'
];

const PHONE_FIELDS = [
  'phone', 'phoneNumber', 'contactPhone', 'pharmacyPhone'
];

// ==================== DANGEROUS PATTERNS ====================

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

const SQL_INJECTION_PATTERNS = [
  /union\s+select/i,
  /;\s*drop\s+table/i,
  /;\s*delete\s+from/i,
  /;\s*update\s+.*\s+set/i,
  /;\s*insert\s+into/i,
  /exec\s*\(/i,
  /execute\s*\(/i,
];

const SQL_KEYWORDS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
  'EXEC', 'EXECUTE', 'UNION', 'DECLARE', 'CAST', 'CONVERT'
];

// ==================== SANITIZATION FUNCTIONS ====================

/**
 * Sanitize string for SQL injection protection
 */
function sanitizeSQLString(input) {
  if (typeof input !== 'string') return input;
  
  let sanitized = input;
  
  // Remove SQL comment patterns
  sanitized = sanitized.replace(/--/g, '');
  sanitized = sanitized.replace(/\/\*/g, '');
  sanitized = sanitized.replace(/\*\//g, '');
  sanitized = sanitized.replace(/#/g, ''); // MySQL comments
  
  // Remove semicolons (statement terminators)
  sanitized = sanitized.replace(/;/g, '');
  
  // Remove NULL bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  return sanitized;
}

/**
 * Sanitize string for XSS protection
 */
function sanitizeXSSString(value, fieldName = '') {
  if (typeof value !== 'string') return value;

  let sanitized = value.trim();

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      console.warn(`🚨 XSS attempt detected in field "${fieldName}":`, sanitized.substring(0, 100));
      
      if (global.Sentry) {
        global.Sentry.captureMessage('XSS attempt detected', {
          level: 'warning',
          tags: { type: 'xss_attempt' },
          extra: {
            field: fieldName,
            value: sanitized.substring(0, 200),
          }
        });
      }
    }
  }

  // Email validation
  if (EMAIL_FIELDS.includes(fieldName)) {
    if (sanitized && !validator.isEmail(sanitized)) {
      console.warn(`⚠️  Invalid email in field "${fieldName}":`, sanitized);
      return sanitized;
    }
    return validator.normalizeEmail(sanitized) || sanitized;
  }

  // Phone validation
  if (PHONE_FIELDS.includes(fieldName)) {
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

  // Remove dangerous protocols
  sanitized = sanitized
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/file:/gi, '');

  // Encode dangerous characters
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  // Preserve newlines for textarea fields
  if (!PRESERVE_NEWLINES.includes(fieldName)) {
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
  }

  // Limit length to prevent DoS
  const MAX_LENGTH = 10000;
  if (sanitized.length > MAX_LENGTH) {
    console.warn(`⚠️  Field "${fieldName}" exceeds max length`);
    sanitized = sanitized.substring(0, MAX_LENGTH);
  }

  return sanitized;
}

/**
 * Combined sanitization (SQL + XSS)
 */
function sanitizeString(value, fieldName = '') {
  if (typeof value !== 'string') return value;
  
  // Apply SQL sanitization first
  let sanitized = sanitizeSQLString(value);
  
  // Then apply XSS sanitization
  sanitized = sanitizeXSSString(sanitized, fieldName);
  
  return sanitized;
}

/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj, parentKey = '') {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item, index) =>
      sanitizeObject(item, `${parentKey}[${index}]`)
    );
  }

  if (
    Buffer.isBuffer(obj) ||
    obj instanceof Date ||
    obj instanceof RegExp ||
    obj instanceof Map ||
    obj instanceof Set
  ) {
    return obj;
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        sanitized[key] = sanitizeObject(obj[key], fullKey);
      }
    }
    return sanitized;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj, parentKey);
  }

  return obj;
}

// ==================== DETECTION FUNCTIONS ====================

/**
 * Detect suspicious SQL injection patterns
 */
function detectSQLInjection(input) {
  if (typeof input !== 'string') return { detected: false };
  
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return {
        detected: true,
        type: 'sql_injection',
        pattern: pattern.toString(),
        input: input.substring(0, 100)
      };
    }
  }
  
  return { detected: false };
}

/**
 * Detect XSS patterns
 */
function detectXSS(input) {
  if (typeof input !== 'string') return { detected: false };
  
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return {
        detected: true,
        type: 'xss',
        pattern: pattern.toString(),
        input: input.substring(0, 100)
      };
    }
  }
  
  return { detected: false };
}

/**
 * Monitor and log suspicious patterns
 */
function monitorSuspiciousPatterns(req, res, next) {
  const checkObject = (obj, location) => {
    if (!obj) return;
    
    const checkValue = (value, key) => {
      if (typeof value === 'string') {
        const sqlResult = detectSQLInjection(value);
        const xssResult = detectXSS(value);
        
        if (sqlResult.detected || xssResult.detected) {
          const result = sqlResult.detected ? sqlResult : xssResult;
          console.warn(`🚨 Suspicious ${result.type} pattern detected:`, {
            location,
            key,
            pattern: result.pattern,
            input: result.input,
            ip: req.ip,
            path: req.path,
            method: req.method
          });
          
          if (global.Sentry) {
            global.Sentry.captureMessage(`${result.type} attempt detected`, {
              level: 'warning',
              tags: { type: result.type },
              extra: {
                pattern: result.pattern,
                input: result.input,
                ip: req.ip,
                path: req.path
              }
            });
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        for (const nestedKey in value) {
          checkValue(value[nestedKey], `${key}.${nestedKey}`);
        }
      }
    };
    
    for (const key in obj) {
      checkValue(obj[key], key);
    }
  };
  
  checkObject(req.query, 'query');
  checkObject(req.body, 'body');
  checkObject(req.params, 'params');
  
  next();
}

// ==================== MIDDLEWARE ====================

/**
 * Main sanitization middleware
 */
function sanitizeInputs(req, res, next) {
  try {
    const startTime = Date.now();

    if (req.body && Object.keys(req.body).length > 0) {
      req.body = sanitizeObject(req.body, 'body');
    }

    if (req.query && Object.keys(req.query).length > 0) {
      req.query = sanitizeObject(req.query, 'query');
    }

    if (req.params && Object.keys(req.params).length > 0) {
      req.params = sanitizeObject(req.params, 'params');
    }

    const duration = Date.now() - startTime;
    
    if (duration > 100) {
      console.warn(`⚠️  Slow sanitization: ${duration}ms for ${req.method} ${req.path}`);
    }

    next();
  } catch (error) {
    console.error('❌ Sanitization error:', error);
    
    if (global.Sentry) {
      global.Sentry.captureException(error, {
        tags: { type: 'sanitization_error' },
        extra: {
          method: req.method,
          path: req.path
        }
      });
    }

    next();
  }
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Validate that input doesn't contain SQL keywords
 */
function validateNoSQLKeywords(input) {
  if (typeof input !== 'string') return true;
  
  for (const keyword of SQL_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(input)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Sanitize search input (strict)
 */
function sanitizeSearchInput(input) {
  if (typeof input !== 'string') return input;
  
  let sanitized = input;
  
  sanitized = sanitized.replace(/[;'"\\]/g, '');
  sanitized = sanitized.replace(/--/g, '');
  sanitized = sanitized.replace(/\/\*/g, '');
  sanitized = sanitized.replace(/\*\//g, '');
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-_.,()]/g, '');
  sanitized = sanitized.trim().substring(0, 100);
  
  return sanitized;
}

/**
 * Encode output for safe HTML display
 */
function encodeForHTML(value) {
  if (typeof value !== 'string') return value;

  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Check if string is safe
 */
function isSafeString(value) {
  if (typeof value !== 'string') return true;

  for (const pattern of [...DANGEROUS_PATTERNS, ...SQL_INJECTION_PATTERNS]) {
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
  sanitizeSQLString,
  sanitizeXSSString,
  sanitizeSearchInput,
  monitorSuspiciousPatterns,
  validateNoSQLKeywords,
  encodeForHTML,
  isSafeString,
  detectSQLInjection,
  detectXSS,
  DANGEROUS_PATTERNS,
  SQL_INJECTION_PATTERNS
};