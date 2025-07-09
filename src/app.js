const express = require('express');
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
     require('dotenv').config();
     const app = express();
     const cors = require('cors');

     app.use(cors());
     app.use(express.json());
     app.use('/uploads', express.static('uploads'));
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