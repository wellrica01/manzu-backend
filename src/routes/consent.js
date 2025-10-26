const express = require('express');
const { recordConsent } = require('../domains/users/consent/consent.service');
const { validateConsent } = require('../utils/validation');
const router = express.Router();

console.log('✅ Consent routes loaded - using domain service with repository pattern');

// POST /consent - Record user or pharmacy user consent
router.post('/', async (req, res) => {
  try {
    // Validate input
    const { error, value } = validateConsent(req.body);
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: 'Invalid input', errors: error.details });
    }

    const consent = await recordConsent(value);
    res.status(201).json({ message: 'Consent recorded', consent });
  } catch (error) {
    console.error('Consent error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;