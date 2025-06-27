const express = require('express');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const checkoutRoutes = require('./routes/checkout');
const confirmationRoutes = require('./routes/confirmation');
const consentRoutes = require('./routes/consent');
const ordersRoutes = require('./routes/orders');
const prescriptionsRoutes = require('./routes/prescriptions');
const providersRoutes = require('./routes/providers');
const servicesRoutes = require('./routes/services');
const trackRoutes = require('./routes/track');
const notificationRoutes = require('./routes/notification');

require('./jobs/cron');
require('dotenv').config();
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/confirmation', confirmationRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/prescriptions', prescriptionsRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/notification', notificationRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;