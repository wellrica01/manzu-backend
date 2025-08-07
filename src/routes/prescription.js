const express = require('express');
const supabase = require('../utils/supabaseClient')
const upload = require('../utils/upload')
const path = require('path');
const fs = require('fs/promises'); // for cleanup after upload if needed
const prescriptionService = require('../services/prescriptionService');
const { isValidEmail, validatePrescriptionUpload, validateAddMedications, validateVerifyPrescription, validatePrescriptionOrder } = require('../utils/validation');
const { authenticate, authenticateAdmin } = require('../middleware/auth');
const requireConsent = require('../middleware/requireConsent');
const router = express.Router();


console.log('Loaded prescription.js version: 2025-06-19-v2');

// POST /prescription/upload - Upload a prescription
router.post('/upload', upload.single('prescriptionFile'), requireConsent, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const userIdentifier = req.headers['x-guest-id'];
    const { contact } = req.body;

    // Validate input
    const { error } = validatePrescriptionUpload({ userIdentifier, contact });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    // Determine if contact is email or phone
    const isEmail = isValidEmail(contact);
    const email = isEmail ? contact : null;
    const phone = !isEmail && contact ? contact : null;

    // Define file path in Supabase Storage
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const filePath = `prescriptions/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('prescriptions') // 🔁 change to your actual bucket name
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError.message);
      return res.status(500).json({ message: 'File upload failed', error: uploadError.message });
    }

    // Get public URL (or you can use signed URLs for privacy)
    const { data: publicUrlData } = supabase.storage
      .from('prescriptions')
      .getPublicUrl(filePath);

    const publicFileUrl = publicUrlData?.publicUrl || null;

    // Save prescription record
    const prescription = await prescriptionService.uploadPrescription({
      userIdentifier,
      email,
      phone,
      fileUrl: publicFileUrl,
    });

    res.status(201).json({
      message: 'Prescription uploaded successfully. You will be notified when it’s ready.',
      prescription,
    });
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
    const { error } = validateAddMedications({ id, medications });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    // Support dosageInstructions in medication addition
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

    // Always use uppercase for status
    const prescription = await prescriptionService.verifyPrescription(Number(id), status.toUpperCase());
    res.status(200).json({ message: 'Prescription updated', prescription });
  } catch (error) {
    console.error('Verification error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /prescriptions/:userIdentifier - Retrieve prescription order details (for guest or user)
router.get('/prescriptions/:userIdentifier', requireConsent, async (req, res) => {
  try {
    const { userIdentifier } = req.params;
    const { lat, lng, radius, state, lga, ward } = req.query;

    // Validate input
    const { error, value } = validatePrescriptionOrder({ userIdentifier, lat, lng, radius });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    // Pass all filters to the service
    const result = await prescriptionService.getPrescriptionOrder({
      ...value,
      state,
      lga,
      ward,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('Prescription order retrieval error:', { message: error.message });
    const statusCode = error.message.includes('Prescription not found') || 
                      error.message.includes('Invalid latitude or longitude') ? 400 : 500;
    res.status(statusCode).json({ message: error.message });
  }
});

// GET /prescription/status - Get prescription statuses for medications
router.get('/status', requireConsent, async (req, res) => {
  try {
    const userIdentifier = req.headers['x-guest-id'];
    const { medicationIds } = req.query;

    if (!userIdentifier) {
      return res.status(400).json({ message: 'User identifier is required' });
    }
    if (!medicationIds) {
      return res.status(400).json({ message: 'Medication IDs are required' });
    }

    const medicationIdArray = medicationIds.split(',').map(id => id.trim());
    if (medicationIdArray.length === 0) {
      return res.status(400).json({ message: 'Invalid medication IDs' });
    }

    const statuses = await prescriptionService.getPrescriptionStatuses({
      userIdentifier,
      medicationIds: medicationIdArray,
    });
    res.status(200).json(statuses);
  } catch (error) {
    console.error('Prescription status error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;