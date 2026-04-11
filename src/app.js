// ✅ Load environment variables FIRST (environment-specific)
const { loadEnvironment } = require('./utils/load-env');
loadEnvironment();

// ✅ Validate environment variables (CRITICAL: Check JWT_SECRET strength)
const { validateEnvironment, checkGitignore } = require('./utils/env-validator');
validateEnvironment();
checkGitignore();

// ✅ Initialize Sentry FIRST (before any other imports)
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  
  // Performance monitoring
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0'),
  profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '1.0'),
  
  // Integrations
  integrations: [
    nodeProfilingIntegration(),
  ],
  
  // Debug mode (only in development)
  debug: process.env.SENTRY_DEBUG === 'true',
  
  // Release tracking
  release: process.env.npm_package_version,
  
  // Before send hook to filter sensitive data
  beforeSend(event, hint) {
    // Don't send events in test environment
    if (process.env.NODE_ENV === 'test') {
      return null;
    }
    
    // Filter out health check errors
    if (event.request?.url?.includes('/health')) {
      return null;
    }
    
    return event;
  },
});

console.log('✅ Sentry initialized:', {
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  dsn: process.env.SENTRY_DSN ? 'Configured' : 'Not configured'
});

const express = require('express');
const helmet = require('helmet');

const medicationRoutes = require('./routes/medication');
const prescriptionRoutes = require('./routes/prescription');
const cartRoutes = require('./routes/cart');
const medCheckoutRoutes = require('./routes/checkout');
const medConfirmationRoutes = require('./routes/confirmation');
const medTrackRoutes = require('./routes/track');
const pharmacyRoutes = require('./routes/pharmacy');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const consentRoutes = require('./routes/consent');
const refundRoutes = require('./routes/refunds');
require('./jobs/cron');

const app = express();
const cors = require('cors');

// ✅ Sentry request handler MUST be first middleware
// Note: Newer Sentry versions handle this automatically with setupExpressErrorHandler

// ====== SECURE CORS CONFIG ======
// ✅ SECURITY: No wildcards, environment-specific whitelist
const getAllowedOrigins = () => {
  // Get from environment variable (comma-separated)
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  }

  // Fallback for development (if ALLOWED_ORIGINS not set)
  if (process.env.NODE_ENV === 'development') {
    console.warn('⚠️  ALLOWED_ORIGINS not set, using development defaults');
    return [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://192.168.69.67:3000',
      'exp://192.168.69.67:8081',
      'http://127.0.0.1:5173'
    ];
  }

  // Production MUST have ALLOWED_ORIGINS set
  console.error('🚨 CRITICAL: ALLOWED_ORIGINS not set in production!');
  return [];
};

const allowedOrigins = getAllowedOrigins();

console.log('✅ CORS Configuration:');
console.log('   Environment:', process.env.NODE_ENV || 'development');
console.log('   Allowed Origins:', allowedOrigins);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) {
      // In production, you might want to block this
      if (process.env.NODE_ENV === 'production') {
        console.warn('⚠️  Request with no origin in production');
      }
      return callback(null, true);
    }

    // Normalize origin (remove trailing slash, lowercase)
    const normalizedOrigin = origin.trim().replace(/\/$/, '').toLowerCase();

    // Check if origin is in whitelist
    const isAllowed = allowedOrigins.some(allowed => 
      allowed.toLowerCase() === normalizedOrigin
    );

    if (isAllowed) {
      console.log(`✅ CORS allowed: ${origin}`);
      return callback(null, true);
    }

    // Log rejected origin for security monitoring
    console.warn(`🚨 CORS BLOCKED: ${origin}`);
    console.warn(`   Allowed origins: ${allowedOrigins.join(', ')}`);
    
    // Report to Sentry
    if (global.Sentry) {
      global.Sentry.captureMessage('CORS request blocked', {
        level: 'warning',
        tags: { type: 'cors_violation' },
        extra: { 
          blockedOrigin: origin,
          allowedOrigins: allowedOrigins
        }
      });
    }

    return callback(new Error(`CORS policy: Origin ${origin} is not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-id'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200
};

// ====== DEBUG HEADER LOGGING ======
// Log every request's method, path, and headers
app.use((req, res, next) => {
  console.log(`\n[${req.method}] ${req.originalUrl}`);
  console.log('Headers:', req.headers);
  next();
});

// Special log for preflight OPTIONS requests
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const reqHeaders = req.headers['access-control-request-headers'];
    if (reqHeaders) {
      console.log(`🚨 Preflight requesting headers: ${reqHeaders}`);
    }
  }
  next();
});

// ====== SECURITY HEADERS (HELMET) ======
// Apply helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
}));

// ====== HTTPS ENFORCEMENT (PRODUCTION ONLY) ======
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // Check if request is using HTTPS
    if (req.header('x-forwarded-proto') !== 'https') {
      console.log(`Redirecting HTTP to HTTPS: ${req.url}`);
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// ====== ENABLE CORS ======
app.use(cors(corsOptions));

// Handle all preflight routes
app.options(/.*/, (req, res, next) => {
  console.log(`\n[Preflight Request] Method: ${req.method}, Path: ${req.originalUrl}, Origin: ${req.headers.origin || 'N/A'}`);
  next();
}, cors(corsOptions));

app.use(express.json());

// ====== XSS & SQL INJECTION PROTECTION ======
// ✅ SECURITY: Consolidated sanitization middleware
const { sanitizeInputs } = require('./middleware/sanitization');
app.use(sanitizeInputs);

console.log('✅ Security: Input sanitization enabled (XSS + SQL injection protection)');

// ====== CONTENT SECURITY POLICY ======
// ✅ SECURITY: Prevent XSS via CSP headers
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );
  
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
});

console.log('✅ CSP Headers: Content Security Policy enabled');

// ====== RATE LIMITING ======
const { apiLimiter, authLimiter, checkoutLimiter } = require('./middleware/rate-limiting');

// ====== HEALTH CHECK ======
app.get('/', (req, res) => {
  res.send('Manzu backend is live 🚀');
});

// ====== API ROUTES ======
// Apply general rate limiting to all API routes
app.use('/api', apiLimiter);
app.use('/api', medicationRoutes);
app.use('/api/prescription', prescriptionRoutes);
app.use('/api/cart', cartRoutes);
// Apply checkout rate limiting
app.use('/api/med-checkout', checkoutLimiter, medCheckoutRoutes);
app.use('/api/med-confirmation', medConfirmationRoutes);
app.use('/api/med-track', medTrackRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
// Apply strict rate limiting to auth routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/refunds', refundRoutes);

// ✅ Sentry error handler (captures errors before custom handlers)
Sentry.setupExpressErrorHandler(app);

// ✅ Custom error handlers (MUST be LAST)
const { errorHandler, notFoundHandler, initializeErrorHandlers } = require('./middleware/error-handler');

// Initialize global error handlers (unhandled rejections, uncaught exceptions)
initializeErrorHandlers();

// 404 handler for unknown routes
app.use(notFoundHandler);

// Main error handler
app.use(errorHandler);

// ====== START SERVER ======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
