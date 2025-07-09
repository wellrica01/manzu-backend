const express = require('express');
const { validateAddToCart, validateUpdateCart, validateRemoveFromCart } = require('../utils/validation');
const cartService = require('../services/cartService');
const router = express.Router();

// Add item to cart
router.post('/add', async (req, res) => {
  try {
    const { medicationId, pharmacyId, quantity } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateAddToCart({ medicationId, pharmacyId, quantity, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { orderItem, userId: returnedUserId } = await cartService.addToCart({ medicationId, pharmacyId, quantity, userId });
    res.status(201).json({ message: 'Added to cart', orderItem, userId: returnedUserId });
  } catch (error) {
    console.error('Cart add error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get cart
router.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-guest-id'];
    if (!userId) {
      return res.status(400).json({ message: 'Guest ID required' });
    }

    const cartData = await cartService.getCart(userId);
    res.status(200).json(cartData);
  } catch (error) {
    console.error('Cart get error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update cart item
router.put('/update', async (req, res) => {
  try {
    const { orderItemId, quantity } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateUpdateCart({ orderItemId, quantity, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const updatedItem = await cartService.updateCartItem({ orderItemId, quantity, userId });
    res.status(200).json({ message: 'Cart updated', orderItem: updatedItem });
  } catch (error) {
    console.error('Cart update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove item from cart
router.delete('/remove/:id', async (req, res) => {
  try {
    const orderItemId = parseInt(req.params.id);
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateRemoveFromCart({ orderItemId, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }
    await cartService.removeFromCart({ orderItemId, userId });
    res.status(200).json({ message: 'Item removed' });
  } catch (error) {
    console.error('Cart remove error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;