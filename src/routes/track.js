const express = require('express');
const { trackOrders } = require('../domains/orders/tracking/tracking.service');
const { validateTracking } = require('../utils/validation');
const router = express.Router();

console.log('✅ Track routes loaded - using domain service with repository pattern');

// GET /track - Track orders by tracking code (updated for new schema)
router.get('/', async (req, res) => {
  try {
    const { trackingCode } = req.query;

    // Validate input
    const { error } = validateTracking({ trackingCode });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await trackOrders(trackingCode);
    res.status(200).json(result);
  } catch (error) {
    console.error('Track error:', { message: error.message, stack: error.stack });
    if (error.message === 'Orders not found or not ready for tracking') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;