const express = require('express');
const { sendVerificationNotification } = require('../utils/notifications');
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { prescriptionId, status, orderId, contact } = req.body;

    if (!prescriptionId || !orderId || !status) {
      return res.status(400).json({ message: 'Prescription ID, order ID, and status are required' });
    }
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const prescription = { id: prescriptionId, email: contact.email, phone: contact.phone, rejectReason: contact.rejectReason };
    const order = { id: orderId };

    await sendVerificationNotification(prescription, status, order);

    res.status(200).json({ message: 'Notification sent successfully' });
  } catch (error) {
    console.error('Notification error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;