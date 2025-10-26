/**
 * INPUT SANITIZER MIDDLEWARE
 * 
 * Defense-in-depth: Sanitize inputs to remove SQL injection patterns
 * Note: Prisma already protects against SQL injection, but this adds an extra layer
 */

/**
 * Sanitize string input to remove SQL injection patterns
 */
function sanitizeString(input) {
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
 * Recursively sanitize object
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Middleware to sanitize request inputs
 */
function sanitizeInputs(req, res, next) {
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  // Sanitize params
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  
  next();
}

/**
 * Check for suspicious SQL injection patterns
 */
function detectSuspiciousPatterns(input) {
  if (typeof input !== 'string') return false;
  
  const suspiciousPatterns = [
    /union\s+select/i,
    /;\s*drop\s+table/i,
    /;\s*delete\s+from/i,
    /;\s*update\s+.*\s+set/i,
    /;\s*insert\s+into/i,
    /exec\s*\(/i,
    /execute\s*\(/i,
    /script>/i,
    /javascript:/i,
    /onerror\s*=/i,
    /onload\s*=/i,
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(input)) {
      return {
        detected: true,
        pattern: pattern.toString(),
        input: input.substring(0, 100) // First 100 chars
      };
    }
  }
  
  return { detected: false };
}

/**
 * Middleware to detect and log suspicious patterns
 */
function monitorSuspiciousPatterns(req, res, next) {
  const checkObject = (obj, location) => {
    if (!obj) return;
    
    const checkValue = (value, key) => {
      if (typeof value === 'string') {
        const result = detectSuspiciousPatterns(value);
        if (result.detected) {
          console.warn('🚨 Suspicious SQL pattern detected:', {
            location,
            key,
            pattern: result.pattern,
            input: result.input,
            ip: req.ip,
            path: req.path,
            method: req.method,
            userAgent: req.get('user-agent')
          });
          
          // Report to Sentry if available
          if (global.Sentry) {
            global.Sentry.captureMessage('Suspicious SQL pattern detected', {
              level: 'warning',
              tags: {
                type: 'sql_injection_attempt',
                location
              },
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
  
  // Check all input sources
  checkObject(req.query, 'query');
  checkObject(req.body, 'body');
  checkObject(req.params, 'params');
  
  next();
}

/**
 * Validate that input doesn't contain SQL keywords
 */
function validateNoSQLKeywords(input) {
  if (typeof input !== 'string') return true;
  
  const sqlKeywords = [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
    'EXEC', 'EXECUTE', 'UNION', 'DECLARE', 'CAST', 'CONVERT'
  ];
  
  const upperInput = input.toUpperCase();
  
  for (const keyword of sqlKeywords) {
    // Check for keyword as whole word (not part of another word)
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(input)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Strict sanitization for search inputs
 */
function sanitizeSearchInput(input) {
  if (typeof input !== 'string') return input;
  
  let sanitized = input;
  
  // Remove all SQL-related characters
  sanitized = sanitized.replace(/[;'"\\]/g, '');
  
  // Remove SQL comments
  sanitized = sanitized.replace(/--/g, '');
  sanitized = sanitized.replace(/\/\*/g, '');
  sanitized = sanitized.replace(/\*\//g, '');
  
  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Limit to alphanumeric, spaces, and basic punctuation
  sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-_.,()]/g, '');
  
  // Trim and limit length
  sanitized = sanitized.trim().substring(0, 100);
  
  return sanitized;
}

module.exports = {
  sanitizeString,
  sanitizeObject,
  sanitizeInputs,
  detectSuspiciousPatterns,
  monitorSuspiciousPatterns,
  validateNoSQLKeywords,
  sanitizeSearchInput
};
