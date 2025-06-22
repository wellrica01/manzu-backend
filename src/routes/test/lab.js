const express = require('express');
const labService = require('../../services/test/labService');
const { validateFetchBookings, validateUpdateBooking, validateFetchTests, validateAddTest, validateUpdateTest, validateDeleteTest, validateFetchUsers, validateRegisterDevice } = require('../../utils/validation');
const { authenticate, authenticateManager } = require('../../middleware/auth');
const router = express.Router();

console.log('Loaded lab.js version: 2025-06-21-v1');

// GET /lab/bookings - Fetch bookings for lab
router.get('/bookings', authenticate, async (req, res) => {
  try {
    // Validate input (no query params to validate, but ensure user context)
    const { error } = validateFetchBookings({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const bookings = await labService.fetchBookings(req.user.labId);
    res.status(200).json({ message: 'Bookings fetched', bookings });
  } catch (error) {
    console.error('Lab bookings error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /lab/bookings/:bookingId - Update booking status
router.patch('/bookings/:bookingId', authenticate, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status } = req.body;

    // Validate input
    const { error } = validateUpdateBooking({ bookingId, status });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedBooking = await labService.updateBookingStatus(Number(bookingId), status, req.user.labId);
    res.status(200).json({ message: 'Booking status updated', booking: updatedBooking });
  } catch (error) {
    console.error('Booking update error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /lab/tests - Fetch lab tests
router.get('/tests', authenticate, async (req, res) => {
  try {
    // Validate input (no query params to validate)
    const { error } = validateFetchTests({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await labService.fetchTests(req.user.labId);
    res.status(200).json({ message: 'Tests fetched', ...result });
  } catch (error) {
    console.error('Lab tests error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /lab/tests - Add new lab test
router.post('/tests', authenticate, async (req, res) => {
  try {
    const { testId, price, available } = req.body;

    // Validate input
    const { error } = validateAddTest({ testId, price, available });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const test = await labService.addTest({
      labId: req.user.labId,
      testId: Number(testId),
      price: Number(price),
      available: Boolean(available),
    });
    res.status(201).json({ message: 'Test added', test });
  } catch (error) {
    console.error('Add test error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /lab/tests - Update lab test
router.patch('/tests', authenticate, async (req, res) => {
  try {
    const { testId, price, available } = req.body;

    // Validate input
    const { error } = validateUpdateTest({ testId, price, available });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedTest = await labService.updateTest({
      labId: req.user.labId,
      testId: Number(testId),
      price: Number(price),
      available: Boolean(available),
    });
    res.status(200).json({ message: 'Test updated', test: updatedTest });
  } catch (error) {
    console.error('Update test error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE /lab/tests - Delete lab test
router.delete('/tests', authenticate, async (req, res) => {
  try {
    const { testId } = req.query;

    // Validate input
    const { error } = validateDeleteTest({ testId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await labService.deleteTest(req.user.labId, Number(testId));
    res.status(200).json({ message: 'Test deleted' });
  } catch (error) {
    console.error('Delete test error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /lab/users - Fetch lab users (manager only)
router.get('/users', authenticate, authenticateManager, async (req, res) => {
  try {
    // Validate input (no query params to validate)
    const { error } = validateFetchUsers({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const users = await labService.fetchUsers(req.user.labId);
    res.status(200).json({ message: 'Users fetched', users });
  } catch (error) {
    console.error('Fetch users error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /lab/notifications/register - Device registration for notifications
router.post('/notifications/register', authenticate, async (req, res) => {
  try {
    const { deviceToken } = req.body;

    // Validate input
    const { error } = validateRegisterDevice({ deviceToken });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await labService.registerDevice(req.user.labId, deviceToken);
    res.status(200).json({ message: 'Device registered for notifications' });
  } catch (error) {
    console.error('Device registration error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;