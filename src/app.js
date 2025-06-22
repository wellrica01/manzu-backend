const express = require('express');
     const medicationRoutes = require('./routes/med/medication');
     const testRoutes = require('./routes/test/test')
     const prescriptionRoutes = require('./routes/med/prescription');
     const testOrderRoutes = require('./routes/test/testorder')
     const cartRoutes = require('./routes/med/cart');
     const bookingRoutes = require('./routes/test/booking')
     const medCheckoutRoutes = require('./routes/med/checkout');
     const testCheckoutRoutes = require('./routes/test/checkout');
     const medConfirmationRoutes = require('./routes/med/confirmation');
     const testConfirmationRoutes = require('./routes/test/confirmation');
     const medTrackRoutes = require('./routes/med/track');
     const testTrackRoutes = require('./routes/test/track');
     const pharmacyRoutes = require('./routes/med/pharmacy');
     const labRoutes = require('./routes/test/lab')
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
     app.use('/api/tests', testRoutes);
     app.use('/api/booking', bookingRoutes);
     app.use('/api/test-order', testOrderRoutes);
     app.use('/api/prescription', prescriptionRoutes);
     app.use('/api/cart', cartRoutes);
     app.use('/api/med-checkout', medCheckoutRoutes);
     app.use('/api/test-checkout', testCheckoutRoutes);
     app.use('/api/med-confirmation', medConfirmationRoutes);
     app.use('/api/test-confirmation', testConfirmationRoutes);
     app.use('/api/med-track', medTrackRoutes);
     app.use('/api/test-track', testTrackRoutes);
     app.use('/uploads', express.static('uploads'));
     app.use('/api/pharmacy', pharmacyRoutes);
     app.use('/api/lab', labRoutes);
     app.use('/api/auth', authRoutes);
     app.use('/api/admin', adminRoutes);
     app.use('/api/consent', consentRoutes);

     const PORT = process.env.PORT || 5000;
     
     
     app.listen(PORT, () => {
       console.log(`Server running on port ${PORT}`);
     });