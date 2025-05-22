// prescription.js
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
    const email = prescription.email || order?.email;
    const phone = prescription.phone || order?.phone;
    if (!email && !phone) {
      console.warn('No contact details for prescription:', { prescriptionId: prescription.id });
      return;
    }
    let msg = {};
    if (status === 'verified') {
      const guestLink = `${process.env.FRONTEND_URL}/guest-order/${prescription.patientIdentifier}`;
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Your Prescription is Ready',
        text: `Your prescription #${prescription.id} has been verified. View your medications and buy them here: ${guestLink}`,
      };
    } else {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Prescription Rejected',
        text: `Your prescription #${prescription.id} was rejected. Please upload a clearer image or contact support.`,
      };
    }
    if (email) {
      await sgMail.send(msg);
      console.log('Email sent:', { email, status, prescriptionId: prescription.id });
    }

    if (phone) {
      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({
        body: status === 'verified'
          ? `Your prescription #${prescription.id} is ready. View and buy: ${guestLink}`
          : `Prescription #${prescription.id} rejected. Please upload again or contact support.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      console.log('SMS sent:', { phone, status, prescriptionId: prescription.id });
    }
  } catch (error) {
    console.error('Notification error:', { message: error.message, prescriptionId: prescription.id });
  }
};

// Upload prescription
router.post('/upload', upload.single('prescriptionFile'), async (req, res) => {
  try {
    console.log('Received request for /api/prescription/upload');
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const { patientIdentifier, email, phone } = req.body;
    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
    }
    const prescription = await prisma.prescription.create({
      data: {
        patientIdentifier,
        email,
        phone,
        fileUrl: `/Uploads/${req.file.filename}`,
        status: 'pending',
        verified: false,
      },
    });
    console.log('Prescription uploaded:', { prescriptionId: prescription.id });
    res.status(201).json({ message: 'Prescription uploaded successfully. You will be notified when it’s ready.', prescription });
  } catch (error) {
    console.error('Upload error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { medications } = req.body; // Expecting array of { medicationId, quantity }
    if (!medications || !Array.isArray(medications) || medications.length === 0) {
      return res.status(400).json({ message: 'Medications array is required' });
    }

    const prescription = await prisma.prescription.findUnique({
      where: { id: Number(id) },
    });
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    if (prescription.status !== 'pending') {
      return res.status(400).json({ message: 'Prescription is already processed' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create order
      const order = await tx.order.create({
        data: {
          patientIdentifier: prescription.patientIdentifier,
          prescriptionId: Number(id),
          status: 'pending_prescription',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          email: prescription.email,
          phone: prescription.phone,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create prescription medications
      const prescriptionMedications = [];
      for (const med of medications) {
        const { medicationId, quantity } = med;
        if (!medicationId || !quantity || quantity < 1) {
          throw new Error('Invalid medication data');
        }
        const medication = await tx.medication.findUnique({
          where: { id: Number(medicationId) },
        });
        if (!medication) {
          throw new Error(`Medication ${medicationId} not found`);
        }
        const prescriptionMedication = await tx.prescriptionMedication.create({
          data: {
            prescriptionId: Number(id),
            medicationId: Number(medicationId),
            quantity,
          },
        });
        prescriptionMedications.push(prescriptionMedication);
      }

      return { order, prescriptionMedications };
    });

    console.log('Order created with medications:', { prescriptionId: id, orderId: result.order.id });
    res.status(201).json({ message: 'Medications added and order created', order: result.order, prescriptionMedications: result.prescriptionMedications });
  } catch (error) {
    console.error('Add medications error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Verify prescription
router.patch('/:id/verify', authenticate, authenticateAdmin, async (req, res) => {
  console.log('Reached PATCH /prescription/:id/verify', { id: req.params.id });
  try {
    const { status } = req.body;
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Use verified or rejected' });
    }

    const prescription = await prisma.prescription.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        orders: {
          include: {
            pharmacy: true,
            items: {
              include: {
                pharmacyMedication: {
                  include: { medication: true },
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
      const prescriptionUpdate = await tx.prescription.update({
        where: { id: Number(req.params.id) },
        data: {
          status,
          verified: status === 'verified',
        },
      });

      if (prescription.orders && prescription.orders.length > 0) {
        if (status === 'rejected') {
          for (const order of prescription.orders) {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: 'cancelled',
                cancelReason: 'Prescription rejected',
                cancelledAt: new Date(),
              },
            });

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
          for (const order of prescription.orders) {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: 'pending',
              },
            });
          }
        }
      }

      return prescriptionUpdate;
    });

    if (prescription.orders && prescription.orders.length > 0) {
      for (const order of prescription.orders) {
        await sendVerificationNotification(updatedPrescription, status, order);
      }
    }

    console.log('Prescription updated:', { prescriptionId: updatedPrescription.id, status });
    res.status(200).json({ message: 'Prescription updated', prescription: updatedPrescription });
  } catch (error) {
    console.error('Verification error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/guest-order/:patientIdentifier', async (req, res) => {
  try {
    const { patientIdentifier } = req.params;
    const { lat, lng, radius = 10 } = req.query;

    const prescription = await prisma.prescription.findFirst({
      where: { patientIdentifier, status: { in: ['pending', 'verified'] } },
      include: {
        PrescriptionMedication: {
          include: {
            Medication: true,
          },
        },
      },
    });

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    const medications = await Promise.all(
      prescription.PrescriptionMedication.map(async (prescriptionMed) => {
        const medication = prescriptionMed.Medication;
        const availability = await prisma.pharmacyMedication.findMany({
          where: {
            medicationId: medication.id,
            stock: { gte: prescriptionMed.quantity },
          },
          include: {
            pharmacy: {
              select: { id: true, name: true, address: true },
            },
          },
        });

        return {
          id: medication.id,
          displayName: `${medication.name}${medication.dosage ? ` ${medication.dosage}` : ''}${medication.form ? ` (${medication.form})` : ''}`,
          quantity: prescriptionMed.quantity,
          availability: availability.map((avail) => ({
            pharmacyId: avail.pharmacy.id,
            pharmacyName: avail.pharmacy.name,
            address: avail.pharmacy.address,
            price: avail.price,
          })),
        };
      })
    );

    const order = await prisma.order.findFirst({
      where: { patientIdentifier, status: { in: ['pending', 'pending_prescription'] } },
    });

    res.status(200).json({ medications, prescriptionId: prescription.id, orderId: order?.id });
  } catch (error) {
    console.error('Guest order retrieval error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Reuse recalculateOrderTotal from cart.js
async function recalculateOrderTotal(prisma, orderId) {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { price: true, quantity: true, pharmacyMedicationPharmacyId: true },
  });
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const subtotals = items.reduce((acc, item) => {
    const pharmacyId = item.pharmacyMedicationPharmacyId;
    acc[pharmacyId] = (acc[pharmacyId] || 0) + item.price * item.quantity;
    return acc;
  }, {});
  const updatedOrder = await prism
System: a.order.update({
    where: { id: orderId },
    data: { totalPrice: total, updatedAt: new Date() },
  });

  return { updatedOrder, subtotals };
}

module.exports = router;