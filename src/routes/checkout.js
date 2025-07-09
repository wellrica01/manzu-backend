const express = require('express');
const { upload } = require('../utils/upload');
const requireConsent = require('../middleware/requireConsent');
const checkoutService = require('../services/checkoutService');
const { validateCheckout, validateSessionRetrieve, validateResume } = require('../utils/validation');
const router = express.Router();

console.log('Loaded checkout.js version: 2025-06-18-v2');

// POST /checkout - Initiate checkout
router.post('/', upload.single('prescription'), requireConsent, async (req, res) => {
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
      file: req.file,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Checkout error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /session/retrieve - Retrieve session by email, phone, or checkoutSessionId
router.post('/session/retrieve', requireConsent, async (req, res) => {
  try {
    const { email, phone, checkoutSessionId } = req.body;

    // Validate input
    const { error } = validateSessionRetrieve({ email, phone, checkoutSessionId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const guestId = await checkoutService.retrieveSession({ email, phone, checkoutSessionId });
    res.status(200).json({ guestId });
  } catch (error) {
    console.error('Session retrieval error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /prescription/validate - Validate prescription for medications
router.get('/prescription/validate', async (req, res) => {
  try {
    const { patientIdentifier, medicationIds } = req.query;

    const requiresUpload = await checkoutService.validatePrescription({ patientIdentifier, medicationIds });
    res.status(200).json({ requiresUpload });
  } catch (error) {
    console.error('Prescription validation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /resume/:orderId - Fetch session details
router.get('/resume/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.headers['x-guest-id'];

    const sessionDetails = await checkoutService.getSessionDetails({ orderId: parseInt(orderId), userId });
    res.status(200).json(sessionDetails);
  } catch (error) {
    console.error('Checkout resume GET error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /resume/:orderId - Resume checkout for a session
router.post('/resume/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { email } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateResume({ orderId: parseInt(orderId), email, userId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await checkoutService.resumeCheckout({ orderId: parseInt(orderId), email, userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Checkout resume error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /resume-orders/:orderId - Fetch pending orders for a session
router.get('/resume-orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.headers['x-guest-id'];

    const result = await checkoutService.getResumeOrders({ orderId: parseInt(orderId), userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Resume orders fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;