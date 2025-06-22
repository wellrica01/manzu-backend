const express = require('express');
     const medicationRoutes = require('./routes/medication');
     const testRoutes = require('./routes/lab/test')
     const prescriptionRoutes = require('./routes/med/prescription');
     const testOrderRoutes = require('./routes/lab/testorder')
     const cartRoutes = require('./routes/med/cart');
     const bookingRoutes = require('./routes/lab/booking')
     const checkoutRoutes = require('./routes/med/checkout');
     const confirmationRoutes = require('./routes/med/confirmation');
     const trackRoutes = require('./routes/med/track');
     const pharmacyRoutes = require('./routes/med/pharmacy');
     const authRoutes = require('./routes/auth');
     const adminRoutes = require('./routes/admin');
     const consentRoutes = require('./routes/consent');
     const notificationRoutes = require('./routes/notifications');
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
     app.use('/api/testorder', testOrderRoutes);
     app.use('/api/prescription', prescriptionRoutes);
     app.use('/api/cart', cartRoutes);
     app.use('/api/checkout', checkoutRoutes);
     app.use('/api/confirmation', confirmationRoutes);
     app.use('/api/track', trackRoutes);
     app.use('/uploads', express.static('uploads'));
     app.use('/api/pharmacy', pharmacyRoutes);
     app.use('/api/auth', authRoutes);
     app.use('/api/admin', adminRoutes);
     app.use('/api/consent', consentRoutes);
     app.use('/api', notificationRoutes);

     const PORT = process.env.PORT || 5000;
     
     
     app.listen(PORT, () => {
       console.log(`Server running on port ${PORT}`);
     });