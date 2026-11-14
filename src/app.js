// src/app.js
// Exports createApp() only. No env load, no Sentry init, no cron, no listen.
// Those live in src/server.js. Tests can now `require('./src/app')` safely.

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { requestId } = require('./middleware/request-id');
const { sanitizeInputs } = require('./middleware/sanitization');
const { apiLimiter, authLimiter, checkoutLimiter } = require('./middleware/rate-limiting');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');

const medicationRoutes = require('./routes/medication');
const prescriptionRoutes = require('./routes/prescription');
const cartRoutes = require('./routes/cart');
const medCheckoutRoutes = require('./routes/checkout');
const medConfirmationRoutes = require('./routes/confirmation');
const medTrackRoutes = require('./routes/track');
const pharmacyRoutes = require('./routes/pharmacy');
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/session');
const adminRoutes = require('./routes/admin');
const consentRoutes = require('./routes/consent');
const refundRoutes = require('./routes/refunds');

const prisma = require('./core/database/prisma');

function getAllowedOrigins() {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  }
  if (process.env.NODE_ENV === 'development') {
    console.warn('ALLOWED_ORIGINS not set, using development defaults');
    return [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://192.168.69.67:3000',
      'exp://192.168.69.67:8081',
      'http://127.0.0.1:5173',
    ];
  }
  console.error('CRITICAL: ALLOWED_ORIGINS not set in production!');
  return [];
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // 1. Request id and actor context (must be first)
  app.use(requestId);

  // 2. CORS
  const allowedOrigins = getAllowedOrigins();
  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) {
        if (process.env.NODE_ENV === 'production') {
          console.warn('Request with no origin in production');
        }
        return callback(null, true);
      }
      const normalizedOrigin = origin.trim().replace(/\/$/, '').toLowerCase();
      const isAllowed = allowedOrigins.some(
        (allowed) => allowed.toLowerCase() === normalizedOrigin,
      );
      if (isAllowed) {
        return callback(null, true);
      }
      console.warn(`CORS BLOCKED: ${origin}`);
      if (global.Sentry) {
        global.Sentry.captureMessage('CORS request blocked', {
          level: 'warning',
          tags: { type: 'cors_violation' },
          extra: { blockedOrigin: origin, allowedOrigins },
        });
      }
      return callback(new Error(`CORS policy: Origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // FND-10: the four client headers the mobile app and web portals send.
    // x-device-id identifies the device (FND-09); x-app-version is the client
    // release (FND-10); x-step-up carries a step-up token (FND-08);
    // idempotency-key is for retry-safe writes (FND-10). Without these in
    // the allow-list, browsers block the preflight and the request never
    // goes out.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-guest-id',
      'x-device-id',
      'x-app-version',
      'x-step-up',
      'idempotency-key',
    ],
    // FND-10: headers the browser is allowed to read from the response.
    // X-Min-App-Version tells the app when it must update; Retry-After is
    // the throttle/step-up hint (FND-02); Idempotent-Replay tells the app
    // that a retried write returned the cached response.
    exposedHeaders: [
      'Content-Length',
      'X-Request-Id',
      'X-Min-App-Version',
      'Retry-After',
      'Idempotent-Replay',
    ],
    maxAge: 86400,
    optionsSuccessStatus: 200,
  };

  // Preflight logging
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      const reqHeaders = req.headers['access-control-request-headers'];
      if (reqHeaders) {
        console.log(`Preflight requesting headers: ${reqHeaders}`);
      }
    }
    next();
  });

  // 3. Helmet
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
    hidePoweredBy: true,
  }));

  // 4. HTTPS redirect in production
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (req.header('x-forwarded-proto') !== 'https') {
        console.log(`Redirecting HTTP to HTTPS: ${req.url}`);
        return res.redirect(`https://${req.header('host')}${req.url}`);
      }
      next();
    });
  }

  // 5. CORS + preflight
  app.use(cors(corsOptions));
  app.options(/.*/, (req, res, next) => {
    console.log(`[Preflight] ${req.method} ${req.originalUrl} origin=${req.headers.origin || 'N/A'}`);
    next();
  }, cors(corsOptions));

  // 6. Body + sanitizer
  app.use(express.json());
  app.use(sanitizeInputs);

  // 7. Second CSP block kept for behavioural parity (Doc 1 §5.5 removes it later)
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
      "form-action 'self';",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // 8. Health
  app.get('/', (req, res) => {
    res.send('Manzu backend is live');
  });

  app.get('/health', async (req, res) => {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        db: 'connected',
        latencyMs: Date.now() - start,
      });
    } catch (error) {
      console.error('Health check failed:', {
        requestId: req.requestId,
        message: error.message,
      });
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        db: 'disconnected',
        message: 'Database unavailable',
        requestId: req.requestId,
      });
    }
  });

  // 9. API routes
  app.use('/api', apiLimiter);
  app.use('/api', medicationRoutes);
  app.use('/api/prescription', prescriptionRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/med-checkout', checkoutLimiter, medCheckoutRoutes);
  app.use('/api/med-confirmation', medConfirmationRoutes);
  app.use('/api/med-track', medTrackRoutes);
  app.use('/api/pharmacy', pharmacyRoutes);
  app.use('/api/auth', sessionRoutes);
  // FND-07b3: authLimiter is now route-level inside routes/auth.js so a
  // successful login does not consume the login throttle budget. Register
  // has its own limiter.
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/consent', consentRoutes);
  app.use('/api/refunds', refundRoutes);

  // 10. Errors
  const Sentry = require('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
