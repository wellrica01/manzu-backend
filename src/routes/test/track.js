const express = require('express');
const bookingTrackService = require('../../services/test/trackService');
const { validateBookingTracking } = require('../../utils/validation');
const router = express.Router();

console.log('Loaded bookingTrack.js version: 2025-06-21-v1');

// GET /booking-track - Track bookings by tracking code
router.get('/', async (req, res) => {
  try {
    const { trackingCode } = req.query;

    // Validate input
    const { error } = validateBookingTracking({ trackingCode });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await bookingTrackService.trackBookings(trackingCode);
    res.status(200).json(result);
  } catch (error) {
    console.error('Booking track error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;