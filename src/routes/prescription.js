const express = require('express');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const router = express.Router();
const prisma = new PrismaClient();

console.log('Loading prescription.js routes');

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);


// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'Uploads/');
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


// Middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.error('No token provided');
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.replace('Bearer ', '');
try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  console.log('Token verified:', { adminId: decoded.adminId, role: decoded.role });
  req.user = decoded;
  next();
} catch (error) {
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Token expired' });
  }
  console.error('Invalid token:', { message: error.message });
  return res.status(401).json({ message: 'Invalid token' });
}

};

const authenticateAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    console.error('Unauthorized: Not an admin', { adminId: req.user?.adminId });
    return res.status(403).json({ message: 'Only admins can perform this action' });
  }
  next();
};

const sendVerificationNotification = async (prescription, status, order) => {
  try {
    const email = order?.email;
    const phone = order?.phone;
    if (!email && !phone) {
      console.warn('No contact details for order:', { orderId: order.id });
      return;
    }
    let msg = {};
    if (status === 'verified') {
      const paymentLink = `${process.env.PAYMENT_URL}/${order?.id}`;
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Prescription Verified',
        text: `Your prescription #${prescription.id} has been verified for order #${order.id}. Complete your payment here: ${paymentLink}`,
      };
    } else {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Prescription Rejected',
        text: `Your prescription #${prescription.id} for order #${order.id} has been rejected. Please contact support.`,
      };
    }
    if (email) {
      await sgMail.send(msg);
      console.log('Email sent:', { email, status, orderId: order.id });
    }

    if (phone) {
      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({
        body: status === 'verified'
          ? `Prescription #${prescription.id} verified for order #${order.id}. Pay here: ${process.env.PAYMENT_URL}/${order.id}`
          : `Prescription #${prescription.id} rejected for order #${order.id}. Contact support.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      console.log('SMS sent:', { phone, status, orderId: order.id });
    }
  } catch (error) {
    console.error('Notification error:', { message: error.message, orderId: order.id });
  }
};

// Upload prescription
router.post('/upload', upload.single('prescriptionFile'), async (req, res) => {
  try {
    console.log('Received request for /api/prescriptions/upload');
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const { patientIdentifier } = req.body;
    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
    }
    const prescription = await prisma.prescription.create({
      data: {
        patientIdentifier,
        fileUrl: `/Uploads/${req.file.filename}`,
        status: 'pending',
        verified: false,
      },
    });
    console.log('Prescription uploaded:', { prescriptionId: prescription.id });
    res.status(201).json({ message: 'Prescription uploaded successfully', prescription });
  } catch (error) {
    console.error('Upload error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Verify prescription
router.patch('/:id/verify', authenticate, authenticateAdmin, async (req, res) => {
  console.log('Reached PATCH /prescriptions/:id/verify', { id: req.params.id });
  try {
    const { status } = req.body;
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Use verified or rejected' });
    }

    // Find prescription and associated orders
    const prescription = await prisma.prescription.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        orders: {
          include: {
            pharmacy: true, // Include pharmacy details
            items: {
              include: {
                pharmacyMedication: {
                  include: { medication: true }, // Include medication details
                },
              },
            },
          },
        },
      },
    });
    if (!prescription) {
      console.error('Prescription not found:', { id: req.params.id });
      return res.status(404).json({ message: 'Prescription not found' });
    }

    if (prescription.status !== 'pending') {
      return res.status(400).json({ message: 'Prescription is already processed' });
    }

    const updatedPrescription = await prisma.$transaction(async (tx) => {
      // Update prescription
      const prescriptionUpdate = await tx.prescription.update({
        where: { id: Number(req.params.id) },
        data: {
          status,
          verified: status === 'verified',
        },
      });

      // Handle orders
      if (prescription.orders && prescription.orders.length > 0) {
        if (status === 'rejected') {
          // Cancel all orders
          for (const order of prescription.orders) {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: 'cancelled',
                cancelReason: 'Prescription rejected',
                cancelledAt: new Date(),
              },
            });

            // Restore stock for each order's items
            if (order.items && order.items.length > 0) {
              for (const item of order.items) {
                await tx.pharmacyMedication.update({
                  where: {
                    pharmacyId_medicationId: {
                      pharmacyId: item.pharmacyMedicationPharmacyId,
                      medicationId: item.pharmacyMedicationMedicationId,
                    },
                  },
                  data: {
                    stock: { increment: item.quantity },
                  },
                });
              }
            }
          }
        } else if (status === 'verified') {
          // Optionally update order status (e.g., to 'confirmed')
          for (const order of prescription.orders) {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: 'confirmed', // Adjust status as needed
              },
            });
          }
        }
      }

      return prescriptionUpdate;
    });

    // Send notifications for each order
    if (prescription.orders && prescription.orders.length > 0) {
      for (const order of prescription.orders) {
        await sendVerificationNotification(updatedPrescription, status, order);
      }
    }

    console.log('Prescription updated:', { prescriptionId: updatedPrescription.id, status, orderCount: prescription.orders.length });
    res.status(200).json({ message: 'Prescription updated', prescription: updatedPrescription });
  } catch (error) {
    console.error('Verification error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;