const express = require('express');
const multer = require('multer');
const path = require('path');
const testOrderService = require('../services/testOrderService');
const { isValidEmail, validateTestOrderUpload, validateAddTest, validateVerifyTestOrder, validateGuestTestOrder } = require('../utils/validation');
const { authenticate, authenticateAdmin } = require('../middleware/auth');
const requireConsent = require('../middleware/requireConsent');
const router = express.Router();

// Multer setup
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

console.log('Loaded testOrder.js version: 2025-06-21-v1');

// POST /testorders/upload - Upload a test order
router.post('/upload', upload.single('testOrderFile'), requireConsent, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const patientIdentifier = req.headers['x-guest-id'];
    const { contact } = req.body;

    // Validate input
    const { error } = validateTestOrderUpload({ patientIdentifier, contact });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    // Determine if contact is email or phone
    const isEmail = isValidEmail(contact);
    const email = isEmail ? contact : null;
    const phone = !isEmail && contact ? contact : null;

    const testOrder = await testOrderService.uploadTestOrder({
      patientIdentifier,
      email,
      phone,
      fileUrl: `/uploads/${req.file.filename}`,
    });
    res.status(201).json({ message: 'Test order uploaded successfully. You will be notified when it’s ready.', testOrder });
  } catch (error) {
    console.error('Upload error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /testorders/:id/tests - Add tests to a test order
router.post('/:id/tests', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tests } = req.body;

    // Validate input
    const { error } = validateAddTest({ id, tests });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await testOrderService.addTests(Number(id), tests);
    res.status(201).json({ message: 'Tests added', testOrderTests: result.testOrderTests });
  } catch (error) {
    console.error('Add tests error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /testorders/:id/verify - Verify or reject a test order
router.patch('/:id/verify', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate input
    const { error } = validateVerifyTestOrder({ id, status });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const testOrder = await testOrderService.verifyTestOrder(Number(id), status);
    res.status(200).json({ message: 'Test order updated', testOrder });
  } catch (error) {
    console.error('Verification error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /testorders/guest-order/:patientIdentifier - Retrieve guest test order details
router.get('/guest-order/:patientIdentifier', requireConsent, async (req, res) => {
  try {
    const { patientIdentifier } = req.params;
    const { lat, lng, radius } = req.query;

    // Validate input
    const { error, value } = validateGuestTestOrder({ patientIdentifier, lat, lng, radius });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await testOrderService.getGuestTestOrder(value);
    res.status(200).json(result);
  } catch (error) {
    console.error('Guest test order retrieval error:', { message: error.message });
    const statusCode = error.message.includes('Test order not found') || 
                      error.message.includes('Invalid latitude or longitude') ? 400 : 500;
    res.status(statusCode).json({ message: error.message });
  }
});

// GET /testorders/status - Get test order statuses for tests
router.get('/status', requireConsent, async (req, res) => {
  try {
    const patientIdentifier = req.headers['x-guest-id'];
    const { testIds } = req.query;

    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
    }
    if (!testIds) {
      return res.status(400).json({ message: 'Test IDs are required' });
    }

    const testIdArray = testIds.split(',').map(id => id.trim());
    if (testIdArray.length === 0) {
      return res.status(400).json({ message: 'Invalid test IDs' });
    }

    const statuses = await testOrderService.getTestOrderStatuses({
      patientIdentifier,
      testIds: testIdArray,
    });
    res.status(200).json(statuses);
  } catch (error) {
    console.error('Test order status error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;