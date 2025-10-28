const express = require('express');
const supabase = require('../utils/supabaseClient')
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { 
  upload, 
  validateUploadedFile, 
  stripMetadataAndCompress, 
  generateSecureFilename 
} = require('../utils/secure-upload');
const path = require('path');
const fs = require('fs/promises'); // for cleanup after upload if needed
const prescriptionService = require('../services/prescriptionService');
const { isValidEmail, validatePrescriptionUpload, validateAddMedications, validateDeleteSingle,
  validateDeleteBulk, validateVerifyPrescription, validatePrescriptionRetrieve, validatePrescriptionOrder } = require('../utils/validation');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const requireConsent = require('../middleware/requireConsent');
const { reportError, ErrorCategory } = require('../utils/error-reporter');
const router = express.Router();

console.log('Loaded prescription.js version: 2025-10-25-v3 (secure upload)');

// POST /prescription/upload - Upload a prescription (SECURE)
router.post('/upload', upload.single('prescriptionFile'), requireConsent, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        message: 'No file uploaded',
        error: 'MISSING_FILE'
      });
    }

    const userIdentifier = req.headers['x-guest-id'];
    const { contact } = req.body;

    // Validate input
    const { error } = validatePrescriptionUpload({ userIdentifier, contact });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const email = isValidEmail(contact) ? contact : null;
    const phone = !email ? contact : null;

    if (!email && !phone) {
      return res.status(400).json({ message: 'Invalid contact format' });
    }

    // Comprehensive file validation
    console.log('Validating uploaded file...');
    const validation = await validateUploadedFile(req.file);
    
    if (!validation.valid) {
      console.warn('File validation failed:', validation.errors);
      return res.status(400).json({ 
        message: 'File validation failed',
        errors: validation.errors,
        error: 'INVALID_FILE'
      });
    }

    console.log('File validation passed:', validation.metadata);

    // Strip EXIF metadata and compress
    console.log('Stripping metadata and compressing...');
    const processed = await stripMetadataAndCompress(req.file.buffer);
    
    if (!processed.success) {
      console.error('Failed to process image:', processed.error);
      return res.status(400).json({ 
        message: 'Failed to process image',
        error: 'PROCESSING_FAILED'
      });
    }

    console.log(`Image processed: ${processed.originalSize} → ${processed.processedSize} bytes (${processed.compressionRatio}% reduction)`);

    // Generate secure random filename
    const secureFileName = generateSecureFilename(req.file.originalname);
    const filePath = `prescriptions/${secureFileName}`;

    console.log(`Uploading to Supabase: ${filePath}`);

    // Upload processed (secure) image to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('prescriptions')
      .upload(filePath, processed.buffer, {
        contentType: 'image/jpeg', // Always JPEG after processing
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError.message);
      
      // Report to Sentry
      reportError(new Error('Supabase upload failed'), {
        category: ErrorCategory.EXTERNAL_API,
        customContext: {
          error: uploadError.message,
          fileName: secureFileName
        }
      });
      
      return res.status(500).json({ 
        message: 'File upload failed', 
        error: 'UPLOAD_FAILED'
      });
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('prescriptions')
      .getPublicUrl(filePath);

    const publicFileUrl = publicUrlData?.publicUrl || null;

    console.log(`File uploaded successfully: ${publicFileUrl}`);

    // Save prescription record
    const prescription = await prescriptionService.uploadPrescription({
      userIdentifier,
      email,
      phone,
      fileUrl: publicFileUrl,
    });

    res.status(201).json({
      message: 'Prescription uploaded successfully. You will be notified when it\'s ready.',
      prescription,
      fileInfo: {
        originalSize: processed.originalSize,
        processedSize: processed.processedSize,
        compressionRatio: processed.compressionRatio + '%',
        secureFilename: secureFileName
      }
    });
  } catch (error) {
    console.error('Upload error:', { message: error.message, stack: error.stack });
    
    // Report to Sentry
    reportError(error, {
      category: ErrorCategory.SYSTEM,
      customContext: {
        fileName: req.file?.originalname,
        fileSize: req.file?.size
      }
    });
    
    res.status(500).json({ 
      message: 'Server error', 
      error: 'INTERNAL_ERROR'
    });
  }
});


router.get('/prescriptions/:id/validity', async (req, res) => {
  try {
    const { id } = req.params;
    
    const prescription = await prisma.prescription.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true,
        status: true,
        expiryDate: true,
        expiryDays: true,
        createdAt: true
      }
    });

    if (!prescription) {
      return res.status(404).json({ error: 'Prescription not found' });
    }

    const now = new Date();
    const isExpired = prescription.status === 'EXPIRED' || 
                     (prescription.expiryDate && now > new Date(prescription.expiryDate));
    
    const daysUntilExpiry = prescription.expiryDate 
      ? Math.ceil((new Date(prescription.expiryDate) - now) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      prescriptionId: prescription.id,
      status: prescription.status,
      isExpired,
      expiryDate: prescription.expiryDate,
      daysUntilExpiry,
      createdAt: prescription.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /prescription/:id/medications - Add medications to a prescription
router.post('/:id/medications', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
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


// -----------------------------
// DELETE single prescription medication
// -----------------------------
router.delete('/remove/:id/medications/:prescriptionMedicationId',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    try {
      const { id, prescriptionMedicationId } = req.params;

      // Validate input
      const { error } = validateDeleteSingle({ id, prescriptionMedicationId });
      if (error) {
        console.error('Validation error:', error.message);
        return res.status(400).json({ message: error.message });
      }

      const result = await prescriptionService.deletePrescriptionMedication(
        Number(id),
        Number(prescriptionMedicationId)
      );

      res.status(200).json({ message: 'Medication deleted', deletedMedication: result });
    } catch (error) {
      console.error('Delete medication error:', error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message });
    }
  }
);

// -----------------------------
// DELETE multiple prescription medications (bulk)
// -----------------------------
router.delete('/remove/:id/medications',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { prescriptionMedicationIds } = req.body;

      // Validate input
      const { error } = validateDeleteBulk({ id, prescriptionMedicationIds });
      if (error) {
        console.error('Validation error:', error.message);
        return res.status(400).json({ message: error.message });
      }

      const result = await prescriptionService.bulkDeletePrescriptionMedications(
        Number(id),
        prescriptionMedicationIds.map(Number)
      );

      res.status(200).json({
        message: 'Medications deleted successfully',
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Bulk delete error:', error);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message });
    }
  }
);



// PATCH /prescription/:id/verify - Verify or reject a prescription
router.patch('/:id/verify', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    // Validate input
    const { error } = validateVerifyPrescription({ id, status, rejectionReason });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const prescription = await prescriptionService.verifyPrescription(
      Number(id), 
      status.toUpperCase(),
      rejectionReason
    );
    res.status(200).json({ message: 'Prescription updated', prescription });
  } catch (error) {
    console.error('Verification error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// POST /prescription/retrieve - Retrieve prescription by email or phone
router.post('/retrieve', requireConsent, async (req, res) => {
  try {
    const { email, phone } = req.body;

    // Validate input
    const { error } = validatePrescriptionRetrieve({ email, phone });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const guestId = await prescriptionService.retrievePrescription({ email, phone });

    // Always return 200 with guestId (null if not found)
    res.status(200).json({ guestId });
  } catch (error) {
    console.error('Session retrieval error:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});




// GET /prescriptions/:userIdentifier - Retrieve prescription order details (for guest or user)
router.get('/:userIdentifier', requireConsent, async (req, res) => {
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