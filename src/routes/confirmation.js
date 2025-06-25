const express = require('express');
const confirmationService = require('../services/confirmationService');
const { validateOrderConfirmation } = require('../utils/validation');
const router = express.Router();

console.log('Loaded confirmation.js version: 2025-06-25-v1');

// GET /confirmation - Confirm payment and retrieve order details
router.get('/', async (req, res) => {
  try {
    const { reference, session } = req.query;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateOrderConfirmation({ reference, session, userId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await confirmationService.confirmOrder({ reference, session, userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Confirmation error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;