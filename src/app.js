const express = require('express');
     const dotenv = require('dotenv');
     const medicationRoutes = require('./routes/medication');
     const prescriptionRoutes = require('./routes/prescription');
     const cartRoutes = require('./routes/cart');
     const checkoutRoutes = require('./routes/checkout');
     const confirmationRoutes = require('./routes/confirmation');
     const trackRoutes = require('./routes/track');
     const pharmacyRoutes = require('./routes/pharmacy');
     dotenv.config();
     const app = express();
     const cors = require('cors');

     app.use(cors());
     app.use(express.json());
     app.use('/api', medicationRoutes);
     app.use('/api/prescription', prescriptionRoutes);
     app.use('/api/cart', cartRoutes);
     app.use('/api/checkout', checkoutRoutes);
     app.use('/api/confirmation', confirmationRoutes);
     app.use('/api/track', trackRoutes);
     app.use('/uploads', express.static('uploads'));
     app.use('/api/pharmacy', pharmacyRoutes);
    

     const PORT = process.env.PORT || 5000;
     
     
     app.listen(PORT, () => {
       console.log(`Server running on port ${PORT}`);
     });