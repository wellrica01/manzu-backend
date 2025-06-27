const express = require('express');
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

    // Placeholder for notification logic (e.g., email, SMS)
    console.log('Sending notification:', { prescriptionId, status, orderId, contact });

    // Example: Send notification via email or phone (to be implemented with actual service)
    const message = status === 'verified'
      ? 'Your prescription has been verified. You can now proceed to checkout.'
      : 'Your prescription was rejected. Please re-upload a valid prescription.';
    
    // TODO: Integrate with email/SMS service (e.g., SendGrid, Twilio)
    // await sendEmailOrSMS(contact, message);

    res.status(200).json({ message: 'Notification sent successfully' });
  } catch (error) {
    console.error('Notification error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;