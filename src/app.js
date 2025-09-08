const express = require('express');
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
  "http://192.168.50.67:3000", 
  "exp://192.168.50.67:8081"                // local dev
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

// ====== ENABLE CORS ======
app.use(cors(corsOptions));

// Handle all preflight routes
app.options(/.*/, (req, res, next) => {
  console.log(`\n[Preflight Request] Method: ${req.method}, Path: ${req.originalUrl}, Origin: ${req.headers.origin || 'N/A'}`);
  next();
}, cors(corsOptions));

app.use(express.json());

// ====== HEALTH CHECK ======
app.get('/', (req, res) => {
  res.send('Manzu backend is live 🚀');
});

// ====== API ROUTES ======
app.use('/api', medicationRoutes);
app.use('/api/prescription', prescriptionRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/med-checkout', medCheckoutRoutes);
app.use('/api/med-confirmation', medConfirmationRoutes);
app.use('/api/med-track', medTrackRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/consent', consentRoutes);

// ====== START SERVER ======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
