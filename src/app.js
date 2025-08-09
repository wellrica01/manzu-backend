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

const allowedOrigins = [
  "https://manzu-frontend-nchi.vercel.app", // production
  "http://localhost:3000",                  // local dev
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true); // Allow requests with no origin (Postman, curl)
    }

    try {
      const cleanOrigin = origin.trim().replace(/\/$/, '').toLowerCase();

      if (allowedOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    } catch (err) {
      return callback(new Error("Invalid origin format"));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

// Preflight logging for all routes
app.options(/.*/, (req, res, next) => {
  console.log(`\n[Preflight Request] Method: ${req.method}, Path: ${req.originalUrl}, Origin: ${req.headers.origin || 'N/A'}`);
  next();
}, cors(corsOptions));

app.use(express.json());

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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
