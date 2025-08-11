const express = require('express');
const requireConsent = require('../middleware/requireConsent');
const checkoutService = require('../services/checkoutService');
const { validateCheckout } = require('../utils/validation');
const router = express.Router();

console.log('Loaded checkout.js version: 2025-06-18-v3');

// POST /checkout - Initiate checkout
router.post('/', requireConsent, async (req, res) => {
  try {
    const { name, email, phone, address, deliveryMethod } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateCheckout({ name, email, phone, address, deliveryMethod, userId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await checkoutService.initiateCheckout({
      name,
      email,
      phone,
      address,
      deliveryMethod,
      userId,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Checkout error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


module.exports = router;