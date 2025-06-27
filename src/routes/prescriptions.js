const express = require('express');
const multer = require('multer');
const path = require('path');
const prescriptionService = require('../services/prescriptionService');
const { isValidEmail, validatePrescriptionUpload, validateAddServices, validateVerifyPrescription, validateGuestOrder } = require('../utils/validation');
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
    cb(null, uniqueSuffix + path.extname(file.originalName));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit to 10MB
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|jpg|jpeg|png/;
    const extname = filetypes.test(path.extname(file.originalName).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Invalid file type. Only PDF, JPG, JPEG, and PNG are allowed.'));
  },
});

console.log('Loaded prescriptions.js version: 2025-06-24-v1');

// POST /prescriptions/upload - Upload a prescription
router.post('/upload', upload.single('prescriptionFile'), requireConsent, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const patientIdentifier = req.headers['x-guest-id'];
    const { contact, orderId, itemIds, type, crossService } = req.body;

    const { error } = validatePrescriptionUpload({ patientIdentifier, contact });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const isEmail = isValidEmail(contact);
    const email = isEmail ? contact : null;
    const phone = !isEmail && contact ? contact : null;

    let parsedItemIds = [];
    try {
      parsedItemIds = itemIds ? JSON.parse(itemIds) : [];
    } catch (e) {
      return res.status(400).json({ message: 'Invalid item IDs format' });
    }

    if (!orderId || isNaN(parseInt(orderId))) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }
    if (!['medication', 'diagnostic'].includes(type)) {
      return res.status(400).json({ message: 'Invalid service type' });
    }

    const prescription = await prescriptionService.uploadPrescription({
      patientIdentifier,
      email,
      phone,
      fileUrl: `/uploads/${req.file.filename}`,
      orderId: parseInt(orderId),
      itemIds: parsedItemIds,
      type,
      crossService: crossService === 'true',
    });
    res.status(201).json({ message: 'Prescription uploaded successfully. You will be notified when it’s ready.', prescription });
  } catch (error) {
    console.error('Upload error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /prescriptions/:id/services - Add services to a prescription
router.post('/:id/services', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { services } = req.body;

    // Validate input
    const { error } = validateAddServices({ id, services });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await prescriptionService.addServices(Number(id), services);
    res.status(201).json({ message: 'Services added', prescriptionServices: result.prescriptionServices });
  } catch (error) {
    console.error('Add services error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /prescriptions/:id/verify - Verify or reject a prescription
router.patch('/:id/verify', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate input
    const { error } = validateVerifyPrescription({ id, status });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const prescription = await prescriptionService.verifyPrescription(Number(id), status);
    res.status(200).json({ message: 'Prescription updated', prescription });
  } catch (error) {
    console.error('Verification error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /prescriptions/guest/:patientIdentifier - Retrieve guest order details
router.get('/guest/:patientIdentifier', requireConsent, async (req, res) => {
  try {
    const { patientIdentifier } = req.params;
    const { lat, lng, radius } = req.query;

    // Validate input
    const { error, value } = validateGuestOrder({ patientIdentifier, lat, lng, radius });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await prescriptionService.getGuestOrder(value);
    res.status(200).json(result);
  } catch (error) {
    console.error('Guest order retrieval error:', { message: error.message });
    const statusCode = error.message.includes('Prescription not found') || 
                      error.message.includes('Invalid latitude or longitude') ? 400 : 500;
    res.status(statusCode).json({ message: error.message });
  }
});

// GET /prescriptions/status - Get prescription statuses for services
router.get('/status', requireConsent, async (req, res) => {
  try {
    const patientIdentifier = req.headers['x-guest-id'];
    const { serviceIds } = req.query;

    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
    }
    if (!serviceIds) {
      return res.status(400).json({ message: 'Service IDs are required' });
    }

    const serviceIdArray = serviceIds.split(',').map(id => id.trim());
    if (serviceIdArray.length === 0) {
      return res.status(400).json({ message: 'Invalid service IDs' });
    }

    const statuses = await prescriptionService.getPrescriptionStatuses({
      patientIdentifier,
      serviceIds: serviceIdArray,
    });
    res.status(200).json(statuses);
  } catch (error) {
    console.error('Prescription status error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;