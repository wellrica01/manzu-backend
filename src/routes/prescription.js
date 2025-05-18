const express = require('express');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const router = express.Router();
const prisma = new PrismaClient();

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Configure Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Middleware to verify JWT and admin role
   const authenticate = (req, res, next) => {
     const authHeader = req.headers.authorization;
     if (!authHeader || !authHeader.startsWith('Bearer ')) {
       console.error('No token provided');
       return res.status(401).json({ message: 'No token provided' });
     }
     const token = authHeader.split(' ')[1];
     try {
       const decoded = jwt.verify(token, process.env.JWT_SECRET);
       req.user = decoded;
       console.log('Token verified:', { adminId: decoded.adminId, role: decoded.role });
       next();
     } catch (error) {
       console.error('Invalid token:', { message: error.message });
       return res.status(401).json({ message: 'Invalid token' });
     }
   };
   const authenticateAdmin = (req, res, next) => {
     if (req.user.role !== 'admin') {
       console.error('Unauthorized: Not an admin', { adminId: req.user.adminId });
       return res.status(403).json({ message: 'Only admins can perform this action' });
     }
     next();
   };

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `prescription-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|jpg|jpeg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only PDF, JPG, JPEG, and PNG files are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Send multi-channel notification
const sendVerificationNotification = async (email, phone, orderId, status) => {
  const resumeUrl = `http://localhost:3000/checkout/resume/${orderId}`;
  const message = status === 'verified'
    ? `Your prescription is verified. Complete payment: ${resumeUrl}`
    : 'Your prescription was rejected. Your order is cancelled. Contact support.';

  const results = [];

  // Email via SendGrid
  if (email && /\S+@\S+\.\S+/.test(email)) {
    try {
      await sgMail.send({
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL || 'no-reply@yourapp.com',
        subject: status === 'verified' ? 'Prescription Verified' : 'Prescription Rejected',
        html: `<p>${message}</p>`,
      });
      results.push({ channel: 'email', status: 'success', email });
    } catch (error) {
      console.error('SendGrid error:', { message: error.message, stack: error.stack });
      results.push({ channel: 'email', status: 'failed', error: error.message });
    }
  }

  // SMS via Twilio
  if (phone && /^\+\d{10,15}$/.test(phone)) {
    try {
      await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      results.push({ channel: 'sms', status: 'success', phone });
    } catch (error) {
      console.error('Twilio SMS error:', { message: error.message, stack: error.stack });
      results.push({ channel: 'sms', status: 'failed', error: error.message });
    }
  }

  console.log('Notification results:', results);

  // Throw if all channels failed
  if (results.length > 0 && results.every(result => result.status === 'failed')) {
    throw new Error('All notification channels failed');
  }

  return results;
};

// Upload prescription
router.post('/upload', upload.single('prescriptionFile'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { patientIdentifier } = req.body;
    if (!patientIdentifier || typeof patientIdentifier !== 'string' || patientIdentifier.trim().length === 0) {
      console.error('Invalid patient identifier:', { patientIdentifier });
      return res.status(400).json({ message: 'Valid patient identifier is required' });
    }

    const prescription = await prisma.prescription.create({
      data: {
        patientIdentifier: patientIdentifier.trim(),
        fileUrl: `/uploads/${req.file.filename}`,
        status: 'pending',
        verified: false,
      },
    });

    console.log('Prescription uploaded:', { id: prescription.id, patientIdentifier });

    res.status(201).json({ message: 'Prescription uploaded successfully', prescription });
  } catch (error) {
    console.error('Upload error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Verify prescription (admin-only)
router.patch('/:id/verify', authenticateAdmin, authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate input
    if (!id || isNaN(parseInt(id))) {
      console.error('Invalid prescription ID:', { id });
      return res.status(400).json({ message: 'Valid prescription ID is required' });
    }

    if (!['verified', 'rejected'].includes(status)) {
      console.error('Invalid status:', { status });
      return res.status(400).json({ message: 'Status must be "verified" or "rejected"' });
    }

    // Find prescription and associated order
    const prescription = await prisma.prescription.findUnique({
      where: { id: parseInt(id) },
      include: { order: true },
    });

    if (!prescription) {
      console.error('Prescription not found:', { id });
      return res.status(404).json({ message: 'Prescription not found' });
    }

    if (!prescription.order) {
      console.error('No order associated with prescription:', { id });
      return res.status(400).json({ message: 'No order associated with this prescription' });
    }

    // Update prescription and order in a transaction
    const updatedPrescription = await prisma.$transaction(async (tx) => {
      const prescription = await tx.prescription.update({
        where: { id: parseInt(id) },
        data: {
          status,
          verified: status === 'verified',
          updatedAt: new Date(),
        },
      });

      if (status === 'rejected') {
        await tx.order.update({
          where: { id: prescription.order.id },
          data: {
            status: 'cancelled',
            cancelReason: 'Prescription rejected',
            cancelledAt: new Date(),
            updatedAt: new Date(),
          },
        });
        // Release stock
        for (const item of prescription.order.items) {
          await tx.pharmacyMedication.update({
            where: {
              pharmacyId_medicationId: {
                pharmacyId: item.pharmacyMedicationPharmacyId,
                medicationId: item.pharmacyMedicationMedicationId,
              },
            },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      return prescription;
    });

     // Send notifications
    const { email, phone } = prescription.order;
    await sendVerificationNotification(email, phone, prescription.order.id, status);

    console.log('Prescription updated:', { id, status, orderId: prescription.order.id });

    res.status(200).json({ message: 'Prescription updated', prescription: updatedPrescription });
  } catch (error) {
    console.error('Verification error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;