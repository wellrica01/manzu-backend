const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const upload = require('../utils/upload')
const { validateFile, generateSecureFilename } = upload;
const supabase = require('../utils/supabaseClient')
const path = require('path');
const { validateAddToCart, validateBulkAddToCart, validateUpdateCart, validateRemoveFromCart, validateBulkRemoveFromCart } = require('../utils/validation');
const cartService = require('../services/cartService');
const requireConsent = require('../middleware/requireConsent');
const router = express.Router();



// Add item to cart
router.post('/add', async (req, res) => {
  const { medicationId, pharmacyId, quantity } = req.body;
  const userId = req.headers['x-guest-id'];

  try {
    // Validate input
    const { error } = validateAddToCart({ medicationId, pharmacyId, quantity, userId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    // Add or update item in cart
    const { orderItem, userId: returnedUserId } = await cartService.addToCart({
      medicationId,
      pharmacyId,
      quantity,
      userId
    });

    return res.status(201).json({
      message: 'Added to cart',
      orderItem,
      userId: returnedUserId
    });
  } catch (error) {
    console.error('Cart add error:', error);

 console.log('INSUFFICIENT_STOCK caught:', {
  message: error.message,
  pharmacyId: error.pharmacyId,
  medicationId: error.medicationId,
  available: error.availableStock,
  requested: error.requestedQuantity
});

    // Check for specific error types
    if (
      error.message === 'INSUFFICIENT_STOCK' ||
      error.message.includes('Only')
    ) {
      try {
        // Fetch pharmacy & medication names
        const [pharmacy, medication] = await Promise.all([
          prisma.pharmacy.findUnique({
            where: { id: error.pharmacyId || pharmacyId },
            select: { name: true }
          }),
          prisma.medication.findUnique({
            where: { id: error.medicationId || medicationId },
            select: { brandName: true, packSizeExpression: true } // ✅ corrected fields
          })
        ]);

        const pharmacyName = pharmacy?.name || 'This pharmacy';
        const medName = medication
          ? `${medication.brandName}${medication.packSizeExpression ? ' (' + medication.packSizeExpression + ')' : ''}`
          : 'this medication';

        const available = error.availableStock || 0;
        const requested = error.requestedQuantity || req.body.quantity;

        // ✅ clearer user-friendly message
        return res.status(409).json({
          message: `${pharmacyName} currently has only ${available} unit${available !== 1 ? 's' : ''} of ${medName} in stock. You requested ${requested}. Please adjust your quantity or choose another pharmacy with available stock.`,
          error: 'INSUFFICIENT_STOCK',
          details: {
            requested,
            available,
            medicationName: medName,
            pharmacyName
          }
        });

      } catch (fetchError) {
        console.error('⚠️ Prisma fetch error:', fetchError);

        // fallback if fetching names fails
        return res.status(409).json({
          message: `Only ${error.availableStock} unit${error.availableStock !== 1 ? 's' : ''} available. You requested ${error.requestedQuantity}.`,
          error: 'INSUFFICIENT_STOCK',
          details: {
            requested: error.requestedQuantity,
            available: error.availableStock
          }
        });
      }
    }


    // 🧩 Medication not found
    if (error.message.includes('Medication not found')) {
      return res.status(404).json({
        message: 'Medication not found',
        error: 'MEDICATION_NOT_FOUND'
      });
    }

    // 🧩 Pharmacy not found
    if (error.message.includes('Pharmacy not found')) {
      return res.status(404).json({
        message: 'Pharmacy not found',
        error: 'PHARMACY_NOT_FOUND'
      });
    }

    // 🧩 Fallback for all other errors
    return res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
});


// Bulk add items to cart
router.post('/add-bulk', async (req, res) => {
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
    
    // ✅ Handle insufficient stock error
    if (error.message.includes('Insufficient stock')) {
      try {
        // Fetch current stock information with pharmacy details
        const orderItem = await prisma.orderItem.findFirst({
          where: { id: req.body.orderItemId },
          include: { 
            MedicationAvailability: {
              include: { 
                Medication: true,
                Pharmacy: true  // ✅ Include pharmacy info
              }
            }
          }
        });

        const availableStock = orderItem?.MedicationAvailability?.stock || 0;
        const medicationName = orderItem?.MedicationAvailability?.Medication?.brandName || 'this item';
        const pharmacyName = orderItem?.MedicationAvailability?.Pharmacy?.name || 'this pharmacy';

        return res.status(409).json({ 
          message: `${pharmacyName} only has ${availableStock} unit${availableStock !== 1 ? 's' : ''} of ${medicationName} in stock`,
          error: 'INSUFFICIENT_STOCK',
          details: {
            orderItemId: req.body.orderItemId,
            requested: req.body.quantity,
            available: availableStock,
            medicationName,
            pharmacyName  // ✅ Include pharmacy name
          }
        });
      } catch (fetchError) {
        // Fallback if we can't fetch the item
        return res.status(409).json({ 
          message: 'Insufficient stock available at this pharmacy',
          error: 'INSUFFICIENT_STOCK',
          details: {
            orderItemId: req.body.orderItemId,
            requested: req.body.quantity,
            available: 0
          }
        });
      }
    }

    // Handle item not found
    if (error.message.includes('Item not found')) {
      return res.status(404).json({
        message: 'Item not found in cart',
        error: 'ITEM_NOT_FOUND'
      });
    }

    // Handle cart not found
    if (error.message.includes('Cart not found')) {
      return res.status(404).json({
        message: 'Cart not found or access denied',
        error: 'CART_NOT_FOUND'
      });
    }
    
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
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
router.delete('/remove-bulk', async (req, res) => {
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
        return res.status(400).json({ 
          message: 'No file was uploaded. Please select a file and try again.',
          error: 'MISSING_FILE'
        });
      }

      const userIdentifier = req.headers['x-guest-id'];
      const { medicationIds, phone } = req.body;

      if (!userIdentifier) {
        return res.status(400).json({ 
          message: 'Session expired. Please refresh the page and try again.' 
        });
      }

      if (!medicationIds) {
        return res.status(400).json({ 
          message: 'No medications selected. Please add items to your cart first.' 
        });
      }

      if (!phone) {
        return res.status(400).json({ 
          message: 'Phone number is required for SMS notifications.' 
        });
      }

      // Call the enhanced service
      const result = await cartService.uploadCartPrescription({
        file: req.file,
        userIdentifier,
        medicationIds,
        phone,
      });

      return res.status(201).json({
        message: "Prescription uploaded successfully! You'll receive an SMS notification when it's verified.",
        prescription: result.prescription,
        fileInfo: result.fileInfo
      });
    } catch (error) {
      console.error('Cart prescription upload error:', error);
      
      const statusCode = error.statusCode || 500;
      
      // User-friendly error messages based on error type
      if (error.message.includes('File validation failed')) {
        return res.status(400).json({ 
          message: 'The uploaded file appears to be corrupted or in an unsupported format. Please try uploading a different file.',
          error: 'INVALID_FILE',
          technicalDetails: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
      
      if (error.message.includes('Failed to process image')) {
        return res.status(400).json({ 
          message: 'We couldn\'t process your image. Please ensure it\'s a clear photo and try again.',
          error: 'PROCESSING_FAILED',
          technicalDetails: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
      
      if (error.message.includes('File upload failed')) {
        return res.status(500).json({ 
          message: 'Upload failed due to a server issue. Please check your internet connection and try again.',
          error: 'UPLOAD_FAILED'
        });
      }

      if (error.message.includes('Prescription not found') || 
          error.message.includes('Medication') && error.message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Some items in your cart are no longer available. Please refresh and try again.',
          error: 'ITEM_NOT_FOUND'
        });
      }
      
      // Generic fallback error
      res.status(statusCode).json({ 
        message: 'Something went wrong while uploading your prescription. Please try again or contact support if the issue persists.',
        error: 'INTERNAL_ERROR'
      });
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


// Validate stock availability before checkout
router.get('/validate-stock', async (req, res) => {
  try {
    const userId = req.headers['x-guest-id'];
    
    if (!userId) {
      return res.status(400).json({ message: 'Guest ID required' });
    }

    const validation = await cartService.validateCartStock(userId);
    
    res.status(200).json(validation);
  } catch (error) {
    console.error('Stock validation error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});


router.post('/auto-adjust-stock', async (req, res) => {
  try {
    const userId = req.headers['x-guest-id'];
    
    if (!userId) {
      return res.status(400).json({ message: 'Guest ID required' });
    }

    const result = await cartService.autoAdjustCartForStock(userId);
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Auto-adjust error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});


module.exports = router;