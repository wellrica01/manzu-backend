const express = require('express');
const multer = require('multer');
const path = require('path');
const { validateAddToCart, validateUpdateCart, validateRemoveFromCart } = require('../utils/validation');
const cartService = require('../services/cartService');
const prescriptionService = require('../services/prescriptionService');
const { isValidEmail } = require('../utils/validation');
const requireConsent = require('../middleware/requireConsent');
const router = express.Router();

// Multer setup for prescription uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit to 10MB
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|jpg|jpeg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Invalid file type. Only PDF, JPG, JPEG, and PNG are allowed.'));
  },
});

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

// Upload prescription for cart items
router.post('/prescription/upload', upload.single('prescriptionFile'), requireConsent, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const userIdentifier = req.headers['x-guest-id'];
    const { medicationIds } = req.body;

    if (!userIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
    }

    if (!medicationIds) {
      return res.status(400).json({ message: 'Medication IDs are required' });
    }

    // Extract contact information from request
    const { email, phone } = req.body;
    
    // Create prescription record
    const prescription = await prescriptionService.uploadPrescription({
      userIdentifier,
      email: email || null,
      phone: phone || null,
      fileUrl: `/uploads/${req.file.filename}`,
    });

    // Parse medication IDs
    const medicationIdArray = medicationIds.split(',').map(id => id.trim()).filter(id => id);

    console.log('Prescription upload - medication IDs:', {
      original: medicationIds,
      parsed: medicationIdArray,
      prescriptionId: prescription.id
    });

    // Add medications to prescription only if there are medications that need it
    if (medicationIdArray.length > 0) {
      const medications = medicationIdArray.map(medicationId => ({
        medicationId: parseInt(medicationId),
        quantity: 1 // Default quantity, can be updated later
      }));

      await prescriptionService.addMedications(prescription.id, medications);
    }

    // Link prescription to specific cart order containing these medications
    await cartService.linkPrescriptionToSpecificOrder({
      prescriptionId: prescription.id,
      userId: userIdentifier,
      medicationIds: medicationIdArray
    });

    res.status(201).json({ 
      message: 'Prescription uploaded successfully for cart items. You will be notified when it\'s ready.', 
      prescription 
    });
  } catch (error) {
    console.error('Cart prescription upload error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get prescription statuses for cart items
router.get('/prescription/status', requireConsent, async (req, res) => {
  try {
    const userIdentifier = req.headers['x-guest-id'];
    const { medicationIds } = req.query;

    if (!userIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
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