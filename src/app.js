const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

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
require('./jobs/cron');

const app = express();
const cors = require('cors');

// ====== CORS CONFIG ======
const allowedOrigins = [
  "https://manzu-frontend-nchi.vercel.app", // production
  "http://192.168.114.67:3000",
  "http://localhost:3000",
  "exp://192.168.114.67:8081"                // local dev
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true); // Allow tools like Postman
    }

    const normalizedOrigin = origin.trim().replace(/\/$/, '').toLowerCase();

    if (
      allowedOrigins.some(o => o.toLowerCase() === normalizedOrigin) ||
      normalizedOrigin.endsWith('.vercel.app')
    ) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-id'] // add more if frontend needs them
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

// ====== RATE LIMITING ======

// TIER 1: General API Rate Limit (Moderate)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req, res) => {
    console.log(`Rate limit exceeded for IP: ${req.ip} on ${req.originalUrl}`);
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  },
});

// TIER 2: Authentication Rate Limit (Strict)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  skipSuccessfulRequests: true, // Only count failed login attempts
  message: {
    error: 'AUTH_RATE_LIMIT_EXCEEDED',
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
      retryAfter: '15 minutes',
      lockoutDuration: '15 minutes'
    });
  },
});

// TIER 3: Payment/Checkout Rate Limit (Restricted)
const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 checkouts per hour
  message: {
    error: 'CHECKOUT_RATE_LIMIT_EXCEEDED',
    message: 'Too many checkout attempts. Please try again after 1 hour.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`Checkout rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'CHECKOUT_RATE_LIMIT_EXCEEDED',
      message: 'Too many checkout attempts from this IP. Please try again after 1 hour.',
      retryAfter: '1 hour'
    });
  },
});

console.log('✅ Rate limiting configured:');
console.log('  - General API: 100 requests / 15 min');
console.log('  - Authentication: 5 attempts / 15 min');
console.log('  - Checkout: 10 attempts / 1 hour');

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

// ====== START SERVER ======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
