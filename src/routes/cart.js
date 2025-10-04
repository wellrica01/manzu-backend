const express = require('express');
const upload = require('../utils/upload')
const supabase = require('../utils/supabaseClient')
const path = require('path');
const { validateAddToCart, validateBulkAddToCart, validateUpdateCart, validateRemoveFromCart, validateBulkRemoveFromCart } = require('../utils/validation');
const cartService = require('../services/cartService');
const prescriptionService = require('../services/prescriptionService');
const { isValidEmail } = require('../utils/validation');
const requireConsent = require('../middleware/requireConsent');
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


// Bulk add items to cart
router.post('/addbulk', async (req, res) => {
  try {
    const { userIdentifier, guestId, items, prescriptionId } = req.body;

    // Validate input
    const { error } = validateBulkAddToCart({ userIdentifier, guestId, items, prescriptionId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { orderItems, userId, addedItems } = await cartService.addBulkToCart({
      userIdentifier,
      guestId,
      items,
      prescriptionId,
    });

    res.status(201).json({ message: 'Added to cart', orderItems, userId, addedItems });
  } catch (error) {
    console.error('Bulk add to cart error:', error);
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


// Bulk remove items from cart
router.delete('/removebulk', async (req, res) => {
  try {
    const { orderItemIds } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    const { error } = validateBulkRemoveFromCart({ orderItemIds, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const { removedItemIds } = await cartService.removeBulkFromCart({ orderItemIds, userId });

    res.status(200).json({
      message: 'Items removed successfully',
      removedItemIds,
      userId,
    });
  } catch (error) {
    console.error('Bulk cart remove error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});



// Upload prescription for cart items
router.post(
  '/prescription/upload',
  upload.single('prescriptionFile'),
  requireConsent,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const userIdentifier = req.headers['x-guest-id'];
      const { medicationIds, email, phone } = req.body;

      if (!userIdentifier) {
        return res.status(400).json({ message: 'User identifier is required' });
      }

      if (!medicationIds) {
        return res.status(400).json({ message: 'Medication IDs are required' });
      }

      // Prepare Supabase file path
      const fileExt = path.extname(req.file.originalname);
      const fileName = `${Date.now()}-${req.file.originalname}`;
      const filePath = `prescriptions/${fileName}`;

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('prescriptions') // Replace with your actual bucket name
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (error) {
        console.error('Supabase upload error:', error);
        return res.status(500).json({ message: 'File upload failed', error: error.message });
      }

      // Optional: Get public URL
      const { data: publicUrlData } = supabase.storage
        .from('prescriptions')
        .getPublicUrl(filePath);

      const publicFileUrl = publicUrlData?.publicUrl || null;

      // Create prescription record
      const prescription = await prescriptionService.uploadPrescription({
        userIdentifier,
        email: email || null,
        phone: phone || null,
        fileUrl: publicFileUrl,
      });

      // Handle medication linking
      const medicationIdArray = medicationIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id);

      console.log('Prescription upload - medication IDs:', {
        original: medicationIds,
        parsed: medicationIdArray,
        prescriptionId: prescription.id,
      });

      if (medicationIdArray.length > 0) {
        const medications = medicationIdArray.map((medicationId) => ({
          medicationId: parseInt(medicationId),
          quantity: 1,
        }));

        await prescriptionService.addMedications(prescription.id, medications);
      }

      await cartService.linkPrescriptionToSpecificOrder({
        prescriptionId: prescription.id,
        userId: userIdentifier,
        medicationIds: medicationIdArray,
      });

      return res.status(201).json({
        message:
          "Prescription uploaded successfully for cart items. You will be notified when it's ready.",
        prescription,
      });
    } catch (error) {
      console.error('Cart prescription upload error:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// Get prescription statuses for cart items
router.get('/prescription/status', requireConsent, async (req, res) => {
  try {
    const userIdentifier = req.headers['x-guest-id'];
    const { medicationIds } = req.query;

    if (!userIdentifier) {
      return res.status(400).json({ message: 'User identifier is required' });
    }
    if (!medicationIds) {
      return res.status(400).json({ message: 'Medication IDs are required' });
    }

    const medicationIdArray = medicationIds.split(',').map(id => id.trim()).filter(id => id);
    if (medicationIdArray.length === 0) {
      return res.status(400).json({ message: 'Invalid medication IDs' });
    }

    const statuses = await cartService.getPrescriptionStatusesForCart({
      userId: userIdentifier,
      medicationIds: medicationIdArray,
    });
    res.status(200).json(statuses);
  } catch (error) {
    console.error('Cart prescription status error:', error); // <-- log full error
    res.status(500).json({ message: 'Server error', error: error.message, stack: error.stack });
  }
});

module.exports = router;