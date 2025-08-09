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
  "https://manzu-frontend-nchi.vercel.app", // production frontend
  "http://localhost:3000",                  // local dev frontend
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // handle preflight
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