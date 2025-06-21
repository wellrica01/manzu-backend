const express = require('express');
const bookingConfirmationService = require('../services/bookingConfirmationService');
const { validateBookingConfirmation } = require('../utils/validation');
const router = express.Router();

console.log('Loaded bookingConfirmation.js version: 2025-06-21-v1');

// GET /booking-confirmation - Confirm payment and retrieve booking details
router.get('/', async (req, res) => {
  try {
    const { reference, session } = req.query;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateBookingConfirmation({ reference, session, userId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await bookingConfirmationService.confirmBooking({ reference, session, userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Booking confirmation error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;