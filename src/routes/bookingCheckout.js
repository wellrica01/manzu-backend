const express = require('express');
const { upload } = require('../utils/upload');
const requireConsent = require('../middleware/requireConsent');
const bookingCheckoutService = require('../services/bookingCheckoutService');
const { validateBookingCheckout, validateBookingSessionRetrieve, validateBookingResume, validateTestOrder } = require('../utils/validation');
const router = express.Router();

console.log('Loaded bookingCheckout.js version: 2025-06-21-v1');

// POST /booking-checkout - Initiate booking checkout
router.post('/', upload.single('testOrder'), requireConsent, async (req, res) => {
  try {
    const { name, email, phone, address, deliveryMethod } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateBookingCheckout({ name, email, phone, address, deliveryMethod, userId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await bookingCheckoutService.initiateBookingCheckout({
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
    console.error('Booking checkout error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /session/retrieve - Retrieve session by email, phone, or checkoutSessionId
router.post('/session/retrieve', requireConsent, async (req, res) => {
  try {
    const { email, phone, checkoutSessionId } = req.body;

    // Validate input
    const { error } = validateBookingSessionRetrieve({ email, phone, checkoutSessionId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const guestId = await bookingCheckoutService.retrieveSession({ email, phone, checkoutSessionId });
    res.status(200).json({ guestId });
  } catch (error) {
    console.error('Session retrieval error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /testorder/validate - Validate test order for tests
router.get('/testorder/validate', async (req, res) => {
  try {
    const { patientIdentifier, testIds } = req.query;

    // Validate input
    const { error } = validateTestOrder({ patientIdentifier, testIds });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const requiresUpload = await bookingCheckoutService.validateTestOrder({ patientIdentifier, testIds });
    res.status(200).json({ requiresUpload });
  } catch (error) {
    console.error('Test order validation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /resume/:bookingId - Fetch session details
router.get('/resume/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.headers['x-guest-id'];

    const sessionDetails = await bookingCheckoutService.getSessionDetails({ bookingId: parseInt(bookingId), userId });
    res.status(200).json(sessionDetails);
  } catch (error) {
    console.error('Booking resume GET error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /resume/:bookingId - Resume checkout for a session
router.post('/resume/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { email } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateBookingResume({ bookingId: parseInt(bookingId), email, userId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await bookingCheckoutService.resumeBookingCheckout({ bookingId: parseInt(bookingId), email, userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Booking resume error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /resume-bookings/:bookingId - Fetch pending bookings for a session
router.get('/resume-bookings/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.headers['x-guest-id'];

    const result = await bookingCheckoutService.getResumeBookings({ bookingId: parseInt(bookingId), userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Resume bookings fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;