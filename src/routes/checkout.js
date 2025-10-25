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

    // Retry logic for deadlocks
    let retries = 0;
    const maxRetries = 5;
    
    while (retries < maxRetries) {
      try {
        const result = await checkoutService.initiateCheckout({
          name,
          email,
          phone,
          address,
          deliveryMethod,
          userId,
        });

        return res.status(200).json(result);
      } catch (error) {
        // Check if it's a deadlock error
        if (error.message && error.message.includes('deadlock detected') && retries < maxRetries - 1) {
          retries++;
          console.log(`Deadlock detected, retrying... (attempt ${retries}/${maxRetries})`);
          // Wait a bit before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 100 * retries));
          continue;
        }
        
        // Check if it's an insufficient stock error
        if (error.message && error.message.includes('Insufficient stock')) {
          return res.status(400).json({ message: error.message });
        }
        
        // Re-throw for outer catch block
        throw error;
      }
    }
    
  } catch (error) {
    console.error('Checkout error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;