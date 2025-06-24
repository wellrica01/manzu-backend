const express = require('express');
const serviceService = require('../services/serviceService');
const { validateServiceSuggestions, validateServiceSearch } = require('../utils/validation');
const router = express.Router();

console.log('Loaded services.js version: 2025-06-24-v1');

// GET /services - Fetch sample services (medication or diagnostic)
router.get('/', async (req, res) => {
  try {
    const { type } = req.query; // Optional: medication, diagnostic, diagnostic_package
    const result = await serviceService.getSampleService(type);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch service data' });
  }
});

// GET /services/suggestions - Fetch autocomplete suggestions
router.get('/suggestions', async (req, res) => {
  try {
    const { q, type } = req.query; // type: medication, diagnostic, diagnostic_package

    // Validate input
    const { error, value } = validateServiceSuggestions({ q, type });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const suggestions = await serviceService.getServiceSuggestions(value.q, value.type);
    res.status(200).json(suggestions);
  } catch (error) {
    console.error('Error fetching service suggestions:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch suggestions' });
  }
});

// GET /services/search - Search services with filtering and sorting
router.get('/search', async (req, res) => {
  try {
    const { q, serviceId, page, limit, lat, lng, radius, state, lga, ward, sortBy, homeCollection, type } = req.query;

    // Validate input
    const { error, value } = validateServiceSearch({
      q,
      serviceId,
      page,
      limit,
      lat,
      lng,
      radius,
      state,
      lga,
      ward,
      sortBy,
      homeCollection,
      type,
    });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await serviceService.searchServices(value);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error searching services:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;