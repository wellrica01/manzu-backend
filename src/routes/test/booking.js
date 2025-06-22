const express = require('express');
const { validateAddToBooking, validateUpdateBooking, validateRemoveFromBooking } = require('../../utils/validation');
const bookingService = require('../../services/test/bookingService');
const router = express.Router();

// Add item to booking
router.post('/add', async (req, res) => {
  try {
    const { testId, labId } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateAddToBooking({ testId, labId, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { bookingItem, userId: returnedUserId } = await bookingService.addToBooking({ testId, labId, userId });
    res.status(201).json({ message: 'Added to booking', bookingItem, userId: returnedUserId });
  } catch (error) {
    console.error('Booking add error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get booking
router.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-guest-id'];
    if (!userId) {
      return res.status(400).json({ message: 'Guest ID required' });
    }

    const bookingData = await bookingService.getBooking(userId);
    res.status(200).json(bookingData);
  } catch (error) {
    console.error('Booking get error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update booking item
router.put('/update', async (req, res) => {
  try {
    const { bookingItemId, quantity } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateUpdateBooking({ bookingItemId, quantity, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const updatedItem = await bookingService.updateBookingItem({ bookingItemId, quantity, userId });
    res.status(200).json({ message: 'Booking updated', bookingItem: updatedItem });
  } catch (error) {
    console.error('Booking update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove item from booking
router.delete('/remove/:id', async (req, res) => {
  try {
    const bookingItemId = parseInt(req.params.id);
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateRemoveFromBooking({ bookingItemId, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }
    await bookingService.removeFromBooking({ bookingItemId, userId });
    res.status(200).json({ message: 'Item removed' });
  } catch (error) {
    console.error('Booking remove error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;