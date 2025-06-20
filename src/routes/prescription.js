const express = require('express');
const multer = require('multer');
const path = require('path');
const prescriptionService = require('../services/prescriptionService');
const { isValidEmail, validatePrescriptionUpload, validateAddMedication, validateVerifyPrescription, validateGuestOrder } = require('../utils/validation');
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

console.log('Loaded prescription.js version: 2025-06-19-v2');

// POST /prescription/upload - Upload a prescription
router.post('/upload', upload.single('prescriptionFile'), requireConsent, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const patientIdentifier = req.headers['x-guest-id'];
    const { contact } = req.body;

    // Validate input
    const { error } = validatePrescriptionUpload({ patientIdentifier, contact });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    // Determine if contact is email or phone
    const isEmail = isValidEmail(contact);
    const email = isEmail ? contact : null;
    const phone = !isEmail && contact ? contact : null;

    const prescription = await prescriptionService.uploadPrescription({
      patientIdentifier,
      email,
      phone,
      fileUrl: `/uploads/${req.file.filename}`,
    });
    res.status(201).json({ message: 'Prescription uploaded successfully. You will be notified when it’s ready.', prescription });
  } catch (error) {
    console.error('Upload error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /prescription/:id/medications - Add medications to a prescription
router.post('/:id/medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { medications } = req.body;

    // Validate input
    const { error } = validateAddMedication({ id, medications });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await prescriptionService.addMedications(Number(id), medications);
    res.status(201).json({ message: 'Medications added', prescriptionMedications: result.prescriptionMedications });
  } catch (error) {
    console.error('Add medications error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /prescription/:id/verify - Verify or reject a prescription
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

// GET /prescription/guest-order/:patientIdentifier - Retrieve guest order details
router.get('/guest-order/:patientIdentifier', requireConsent, async (req, res) => {
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

// GET /prescription/status - Get prescription statuses for medications
router.get('/status', requireConsent, async (req, res) => {
  try {
    const patientIdentifier = req.headers['x-guest-id'];
    const { medicationIds } = req.query;

    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
    }
    if (!medicationIds) {
      return res.status(400).json({ message: 'Medication IDs are required' });
    }

    const medicationIdArray = medicationIds.split(',').map(id => id.trim());
    if (medicationIdArray.length === 0) {
      return res.status(400).json({ message: 'Invalid medication IDs' });
    }

    const statuses = await prescriptionService.getPrescriptionStatuses({
      patientIdentifier,
      medicationIds: medicationIdArray,
    });
    res.status(200).json(statuses);
  } catch (error) {
    console.error('Prescription status error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;