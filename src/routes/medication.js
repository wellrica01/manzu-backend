const express = require('express');
const medicationService = require('../services/medicationService');
const { validateMedications, validateMedicationSuggestions, validateMedicationSearch } = require('../utils/validation');
const router = express.Router();

console.log('Loaded medication.js version: 2025-06-19-v2 (new schema)');

// GET /medications - Fetch a sample medication (new schema)
router.get('/medications', async (req, res) => {
  try {
    // No input validation needed for this endpoint
    const result = await medicationService.getSampleMedication();
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching medication:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch medication data' });
  }
});

// GET /medication-suggestions - Fetch autocomplete suggestions (new schema)
router.get('/medication-suggestions', async (req, res) => {
  try {
    const { q } = req.query;

    // Validate input
    const { error, value } = validateMedicationSuggestions({ q });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const suggestions = await medicationService.getMedicationSuggestions(value.q);
    res.status(200).json(suggestions);
  } catch (error) {
    console.error('Error fetching medication suggestions:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch suggestions' });
  }
});

// GET /search - Search medications with filtering and sorting (new schema)
router.get('/search', async (req, res) => {
  try {
    const { q, medicationId, page, limit, lat, lng, radius, state, lga, ward, sortBy } = req.query;

    // Validate input
    const { error, value } = validateMedicationSearch({ q, medicationId, page, limit, lat, lng, radius, state, lga, ward, sortBy });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await medicationService.searchMedications(value);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error searching medications:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;