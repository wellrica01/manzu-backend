const express = require('express');
const consentService = require('../services/consentService');
const { validateConsent } = require('../utils/validation');
const router = express.Router();

console.log('Loaded consent.js version: 2025-06-19-v1');

// POST /consent - Record patient or pharmacy user consent
router.post('/', async (req, res) => {
  try {
    // Validate input
    const { error, value } = validateConsent(req.body);
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: 'Invalid input', errors: error.details });
    }

    const consent = await consentService.recordConsent(value);
    res.status(201).json({ message: 'Consent recorded', consent });
  } catch (error) {
    console.error('Consent error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;