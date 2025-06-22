const express = require('express');
const testService = require('../../services/lab/testService');
const { validateTests, validateTestSuggestions, validateTestSearch } = require('../../utils/validation');
const router = express.Router();

console.log('Loaded test.js version: 2025-06-21-v1');

// GET /tests - Fetch a sample test
router.get('/', async (req, res) => {
  try {
    // No input validation needed for this endpoint
    const result = await testService.getSampleTest();
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching test:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch test data' });
  }
});

// GET /test-suggestions - Fetch autocomplete suggestions
router.get('/test-suggestions', async (req, res) => {
  try {
    const { q } = req.query;

    // Validate input
    const { error, value } = validateTestSuggestions({ q });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const suggestions = await testService.getTestSuggestions(value.q);
    res.status(200).json(suggestions);
  } catch (error) {
    console.error('Error fetching test suggestions:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch suggestions' });
  }
});

// GET /search - Search tests with filtering and sorting
router.get('/search', async (req, res) => {
  try {
    const { q, testId, page, limit, lat, lng, radius, state, lga, ward, sortBy } = req.query;

    // Validate input
    const { error, value } = validateTestSearch({ q, testId, page, limit, lat, lng, radius, state, lga, ward, sortBy });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await testService.searchTests(value);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error searching tests:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;