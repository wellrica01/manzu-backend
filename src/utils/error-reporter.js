/**
 * ERROR REPORTER UTILITY
 * 
 * Centralized error reporting with Sentry integration
 * Provides helpers for common error scenarios with automatic context enrichment
 */

const Sentry = require('@sentry/node');

/**
 * Error severity levels
 */
const ErrorLevel = {
  CRITICAL: 'fatal',    // Payment failures, data corruption
  ERROR: 'error',       // API failures, unexpected errors
  WARNING: 'warning',   // Validation failures, rate limits
  INFO: 'info',         // Business events, audits
  DEBUG: 'debug'        // Development debugging
};

/**
 * Error categories for grouping
 */
const ErrorCategory = {
  PAYMENT: 'payment',
  STOCK: 'stock',
  PRESCRIPTION: 'prescription',
  AUTH: 'authentication',
  VALIDATION: 'validation',
  DATABASE: 'database',
  EXTERNAL_API: 'external_api',
  WEBHOOK: 'webhook',
  RATE_LIMIT: 'rate_limit',
  SYSTEM: 'system'
};

/**
 * Sanitize sensitive data before sending to Sentry
 */
function sanitizeData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = { ...data };
  const sensitivePatterns = [
    'password',
    'token',
    'secret',
    'key', // Catches apiKey, api_key, secretKey, etc.
    'authorization',
    'card', // Catches cardNumber, card_number, creditCard, etc.
    'cvv',
    'pin',
    'ssn'
  ];

  for (const key in sanitized) {
    const lowerKey = key.toLowerCase();
    
    // Check if key contains any sensitive pattern
    const isSensitive = sensitivePatterns.some(pattern => 
      lowerKey.includes(pattern.toLowerCase())
    );
    
    // Remove sensitive fields
    if (isSensitive && key !== 'email') {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    // Hash user identifiers for privacy
    if (key === 'email' && typeof sanitized[key] === 'string') {
      const email = sanitized[key];
      const [local, domain] = email.split('@');
      sanitized[key] = `${local.substring(0, 2)}***@${domain}`;
      continue;
    }
    
    // Recursively sanitize nested objects
    if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeData(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Report error to Sentry with context
 */
function reportError(error, {
  level = ErrorLevel.ERROR,
  category = ErrorCategory.SYSTEM,
  user = null,
  request = null,
  orderId = null,
  pharmacyId = null,
  transactionId = null,
  customContext = {}
} = {}) {
  try {
    // Set error level
    Sentry.withScope((scope) => {
      scope.setLevel(level);
      
      // Add category tag
      scope.setTag('category', category);
      
      // Add user context (sanitized)
      if (user) {
        scope.setUser({
          id: user.id || user.userIdentifier,
          email: user.email ? sanitizeData({ email: user.email }).email : undefined,
          role: user.role
        });
      }
      
      // Add request context
      if (request) {
        scope.setContext('request', {
          method: request.method,
          url: request.url,
          headers: sanitizeData(request.headers),
          query: sanitizeData(request.query),
          body: sanitizeData(request.body),
          ip: request.ip
        });
      }
      
      // Add business context
      if (orderId) {
        scope.setTag('order_id', orderId);
        scope.setContext('order', { id: orderId });
      }
      
      if (pharmacyId) {
        scope.setTag('pharmacy_id', pharmacyId);
        scope.setContext('pharmacy', { id: pharmacyId });
      }
      
      if (transactionId) {
        scope.setTag('transaction_id', transactionId);
        scope.setContext('transaction', { id: transactionId });
      }
      
      // Add custom context (sanitized)
      if (Object.keys(customContext).length > 0) {
        scope.setContext('custom', sanitizeData(customContext));
      }
      
      // Add environment info
      scope.setTag('node_env', process.env.NODE_ENV || 'development');
      
      // Capture the error
      Sentry.captureException(error);
    });
    
    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error reported to Sentry:', {
        message: error.message,
        level,
        category,
        orderId,
        pharmacyId
      });
    }
  } catch (reportingError) {
    // Don't let error reporting crash the app
    console.error('Failed to report error to Sentry:', reportingError);
    console.error('Original error:', error);
  }
}

/**
 * Report payment error
 */
function reportPaymentError(error, {
  orderId,
  transactionId,
  amount,
  paymentMethod,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.CRITICAL,
    category: ErrorCategory.PAYMENT,
    user,
    request,
    orderId,
    transactionId,
    customContext: {
      amount,
      paymentMethod
    }
  });
}

/**
 * Report stock error
 */
function reportStockError(error, {
  medicationId,
  pharmacyId,
  requestedQuantity,
  availableStock,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.ERROR,
    category: ErrorCategory.STOCK,
    user,
    request,
    pharmacyId,
    customContext: {
      medicationId,
      requestedQuantity,
      availableStock
    }
  });
}

/**
 * Report prescription error
 */
function reportPrescriptionError(error, {
  prescriptionId,
  userId,
  status,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.ERROR,
    category: ErrorCategory.PRESCRIPTION,
    user,
    request,
    customContext: {
      prescriptionId,
      userId,
      status
    }
  });
}

/**
 * Report authentication error
 */
function reportAuthError(error, {
  email,
  attemptedRole,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.WARNING,
    category: ErrorCategory.AUTH,
    user,
    request,
    customContext: {
      email: email ? sanitizeData({ email }).email : undefined,
      attemptedRole
    }
  });
}

/**
 * Report validation error
 */
function reportValidationError(error, {
  field,
  value,
  constraint,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.WARNING,
    category: ErrorCategory.VALIDATION,
    user,
    request,
    customContext: {
      field,
      value: sanitizeData({ value }).value,
      constraint
    }
  });
}

/**
 * Report database error
 */
function reportDatabaseError(error, {
  operation,
  table,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.CRITICAL,
    category: ErrorCategory.DATABASE,
    user,
    request,
    customContext: {
      operation,
      table
    }
  });
}

/**
 * Report external API error
 */
function reportExternalAPIError(error, {
  api,
  endpoint,
  statusCode,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.ERROR,
    category: ErrorCategory.EXTERNAL_API,
    user,
    request,
    customContext: {
      api,
      endpoint,
      statusCode
    }
  });
}

/**
 * Report webhook error
 */
function reportWebhookError(error, {
  eventType,
  eventId,
  provider,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.CRITICAL,
    category: ErrorCategory.WEBHOOK,
    request,
    customContext: {
      eventType,
      eventId,
      provider
    }
  });
}

/**
 * Report rate limit error
 */
function reportRateLimitError(error, {
  endpoint,
  limit,
  window,
  user,
  request
} = {}) {
  reportError(error, {
    level: ErrorLevel.WARNING,
    category: ErrorCategory.RATE_LIMIT,
    user,
    request,
    customContext: {
      endpoint,
      limit,
      window
    }
  });
}

/**
 * Report business event (info level)
 */
function reportBusinessEvent(message, {
  eventType,
  user,
  orderId,
  pharmacyId,
  customContext = {}
} = {}) {
  Sentry.withScope((scope) => {
    scope.setLevel(ErrorLevel.INFO);
    scope.setTag('event_type', eventType);
    
    if (user) {
      scope.setUser({
        id: user.id || user.userIdentifier,
        role: user.role
      });
    }
    
    if (orderId) scope.setTag('order_id', orderId);
    if (pharmacyId) scope.setTag('pharmacy_id', pharmacyId);
    
    scope.setContext('event', sanitizeData(customContext));
    
    Sentry.captureMessage(message, ErrorLevel.INFO);
  });
}

/**
 * Add breadcrumb for debugging
 */
function addBreadcrumb(message, {
  category = 'default',
  level = 'info',
  data = {}
} = {}) {
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data: sanitizeData(data),
    timestamp: Date.now() / 1000
  });
}

/**
 * Set user context globally
 */
function setUser(user) {
  if (user) {
    Sentry.setUser({
      id: user.id || user.userIdentifier,
      email: user.email ? sanitizeData({ email: user.email }).email : undefined,
      role: user.role
    });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Clear user context
 */
function clearUser() {
  Sentry.setUser(null);
}

// ============================================
// CRITICAL ALERTING SYSTEM
// ============================================

/**
 * Critical alert types that require immediate attention
 */
const AlertType = {
  // Payment & Financial
  PAYMENT_GATEWAY_DOWN: 'payment_gateway_down',
  PAYMENT_VERIFICATION_FAILED: 'payment_verification_failed',
  REFUND_PROCESSING_FAILED: 'refund_processing_failed',
  PAYMENT_RECONCILIATION_MISMATCH: 'payment_reconciliation_mismatch',
  
  // Database & Infrastructure
  DATABASE_CONNECTION_LOST: 'database_connection_lost',
  HIGH_ERROR_RATE: 'high_error_rate',
  
  // Business Logic
  ORDER_STUCK_IN_PENDING: 'order_stuck_in_pending',
  STOCK_SYNC_FAILED: 'stock_sync_failed',
  
  // External Services
  EXTERNAL_API_DOWN: 'external_api_down',
  NOTIFICATION_SERVICE_DOWN: 'notification_service_down',
};

/**
 * Send critical alert to Sentry (triggers immediate notification)
 */
function sendCriticalAlert({
  alertType,
  message,
  error = null,
  context = {},
  tags = {}
}) {
  Sentry.withScope((scope) => {
    // Set as FATAL level for immediate attention
    scope.setLevel('fatal');
    
    // Set fingerprint for proper grouping
    scope.setFingerprint([alertType, process.env.NODE_ENV || 'development']);
    
    // Add alert metadata
    scope.setTag('alert_type', alertType);
    scope.setTag('alert_severity', 'critical');
    scope.setTag('requires_immediate_action', 'true');
    
    // Add custom tags
    Object.entries(tags).forEach(([key, value]) => {
      scope.setTag(key, String(value));
    });
    
    // Add context data
    scope.setContext('alert_details', {
      alertType,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      ...sanitizeData(context)
    });
    
    // Capture the alert
    if (error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(message, 'fatal');
    }
  });
  
  // Also log to console
  console.error(`🚨 CRITICAL ALERT:`, {
    type: alertType,
    message,
    context
  });
}

/**
 * Alert for payment gateway failures
 */
function alertPaymentGatewayDown(gatewayName, error, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.PAYMENT_GATEWAY_DOWN,
    message: `⚠️ Payment gateway ${gatewayName} is DOWN - No payments can be processed!`,
    error,
    context: {
      gateway: gatewayName,
      impact: 'All payment processing blocked',
      ...context
    },
    tags: {
      gateway: gatewayName,
      category: 'payment',
      impact: 'high'
    }
  });
}

/**
 * Alert for payment verification failures
 */
function alertPaymentVerificationFailed(transactionRef, error, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.PAYMENT_VERIFICATION_FAILED,
    message: `⚠️ Payment verification FAILED for ${transactionRef} - Customer may have paid but order not confirmed!`,
    error,
    context: {
      transactionRef,
      impact: 'Customer paid but order not processed',
      action_required: 'Manual verification needed',
      ...context
    },
    tags: {
      transaction_ref: transactionRef,
      category: 'payment',
      impact: 'critical'
    }
  });
}

/**
 * Alert for refund processing failures
 */
function alertRefundProcessingFailed(refundId, orderId, amount, error, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.REFUND_PROCESSING_FAILED,
    message: `⚠️ Refund processing FAILED for refund #${refundId} (₦${amount}) - Customer expecting refund!`,
    error,
    context: {
      refundId,
      orderId,
      amount,
      impact: 'Customer not refunded',
      action_required: 'Process refund manually via Paystack dashboard',
      ...context
    },
    tags: {
      refund_id: String(refundId),
      order_id: String(orderId),
      category: 'refund',
      impact: 'critical'
    }
  });
}

/**
 * Alert for database connection issues
 */
function alertDatabaseConnectionLost(error, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.DATABASE_CONNECTION_LOST,
    message: '⚠️ DATABASE CONNECTION LOST - Application cannot function!',
    error,
    context: {
      impact: 'All database operations failing',
      action_required: 'Check database server and connection pool',
      ...context
    },
    tags: {
      category: 'database',
      impact: 'critical'
    }
  });
}

/**
 * Alert for high error rates
 */
function alertHighErrorRate(errorCount, timeWindow, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.HIGH_ERROR_RATE,
    message: `⚠️ HIGH ERROR RATE: ${errorCount} errors in ${timeWindow} seconds - System may be degraded!`,
    context: {
      errorCount,
      timeWindow,
      impact: 'Multiple users affected',
      action_required: 'Check logs and system health',
      ...context
    },
    tags: {
      error_count: String(errorCount),
      category: 'system',
      impact: 'high'
    }
  });
}

/**
 * Alert for external API failures
 */
function alertExternalApiDown(apiName, error, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.EXTERNAL_API_DOWN,
    message: `⚠️ External API ${apiName} is DOWN or unreachable!`,
    error,
    context: {
      apiName,
      impact: `${apiName} functionality unavailable`,
      ...context
    },
    tags: {
      api_name: apiName,
      category: 'external_api',
      impact: 'high'
    }
  });
}

/**
 * Alert for stuck orders
 */
function alertOrdersStuckInPending(orderCount, oldestOrderAge, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.ORDER_STUCK_IN_PENDING,
    message: `⚠️ ${orderCount} orders stuck in PENDING status (oldest: ${oldestOrderAge} hours) - Revenue at risk!`,
    context: {
      orderCount,
      oldestOrderAge,
      impact: 'Orders not being fulfilled',
      action_required: 'Review stuck orders and payment status',
      ...context
    },
    tags: {
      order_count: String(orderCount),
      category: 'business_logic',
      impact: 'medium'
    }
  });
}

/**
 * Alert for payment reconciliation mismatches
 */
function alertPaymentReconciliationMismatch(mismatchCount, totalAmount, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.PAYMENT_RECONCILIATION_MISMATCH,
    message: `⚠️ Payment reconciliation found ${mismatchCount} mismatches totaling ₦${totalAmount} - Financial discrepancy!`,
    context: {
      mismatchCount,
      totalAmount,
      impact: 'Financial records inconsistent',
      action_required: 'Review reconciliation report and investigate discrepancies',
      ...context
    },
    tags: {
      mismatch_count: String(mismatchCount),
      category: 'payment',
      impact: 'critical'
    }
  });
}

/**
 * Alert for notification service failures
 */
function alertNotificationServiceDown(serviceName, error, context = {}) {
  sendCriticalAlert({
    alertType: AlertType.NOTIFICATION_SERVICE_DOWN,
    message: `⚠️ Notification service ${serviceName} is DOWN - Customers not receiving updates!`,
    error,
    context: {
      serviceName,
      impact: 'Email/SMS notifications not being sent',
      action_required: 'Check SendGrid/Twilio status and credentials',
      ...context
    },
    tags: {
      service_name: serviceName,
      category: 'notification',
      impact: 'high'
    }
  });
}

module.exports = {
  ErrorLevel,
  ErrorCategory,
  reportError,
  reportPaymentError,
  reportStockError,
  reportPrescriptionError,
  reportAuthError,
  reportValidationError,
  reportDatabaseError,
  reportExternalAPIError,
  reportWebhookError,
  reportRateLimitError,
  reportBusinessEvent,
  addBreadcrumb,
  setUser,
  clearUser,
  sanitizeData,
  // Critical alerting functions
  AlertType,
  sendCriticalAlert,
  alertPaymentGatewayDown,
  alertPaymentVerificationFailed,
  alertRefundProcessingFailed,
  alertDatabaseConnectionLost,
  alertHighErrorRate,
  alertExternalApiDown,
  alertOrdersStuckInPending,
  alertPaymentReconciliationMismatch,
  alertNotificationServiceDown,
};
