const express = require('express');
const trackService = require('../services/trackService');
const { validateTracking } = require('../utils/validation');
const router = express.Router();

console.log('Loaded track.js version: 2025-06-25-v1');

// GET /track - Track orders by tracking code
router.get('/', async (req, res) => {
  try {
    const { trackingCode } = req.query;

    // Validate input
    const { error } = validateTracking({ trackingCode });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await trackService.trackOrders(trackingCode);
    res.status(200).json(result);
  } catch (error) {
    console.error('Track error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;