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
const requireConsent = require('../middleware/requireConsent');

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Phone Normalization
const normalizePhone = (phone) => {
  let cleaned = phone.replace(/[^+\d]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+234' + cleaned.slice(1);
  } else if (cleaned.startsWith('234')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
};

const isValidPhone = (phone) => {
  const basicFormat = /^(?:\+?234[0-9]{10}|0[0-9]{10})$/;
  if (!basicFormat.test(phone)) return false;
  const normalized = normalizePhone(phone);
  return /^\+234[0-9]{10}$/.test(normalized);
};


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
    let guestLink = `${process.env.FRONTEND_URL}/status-check?patientIdentifier=${prescription.patientIdentifier}`;
    if (order && order.totalPrice > 0) {
      guestLink += `&orderId=${order.id}`;
    }
    let msg = {};
    if (status === 'verified') {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Your Prescription is Ready',
        text: `Your prescription #${prescription.id} has been verified. ${order && order.totalPrice > 0 ? 'Complete your order payment' : 'View your medications and select pharmacies'}: ${guestLink}`,
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
          ? `Prescription #${prescription.id} verified. ${order && order.totalPrice > 0 ? 'Pay for your order' : 'Select pharmacies'}: ${guestLink}`
          : `Prescription #${prescription.id} rejected. Upload again or contact support.`,
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
router.post('/upload', upload.single('prescriptionFile'), requireConsent, async (req, res) => {
  try {
    console.log('Received request for /api/prescription/upload');
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const patientIdentifier = req.headers['x-guest-id'];
    const { email, phone } = req.body;
    if (!patientIdentifier) {
      return res.status(400).json({ message: 'Patient identifier is required' });
    }
    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ message: 'Invalid phone number format (e.g., 09031615501 or +2349031615501)' });
    }
    const normalizedPhone = phone ? normalizePhone(phone) : phone;
    const prescription = await prisma.prescription.create({
      data: {
        patientIdentifier,
        email,
        phone: normalizedPhone,
        fileUrl: `/uploads/${req.file.filename}`,
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

      return { prescriptionMedications };
    });

    console.log('Medications added:', { prescriptionId: id });
    res.status(201).json({ message: 'Medications added',  prescriptionMedications: result.prescriptionMedications });
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

router.get('/guest-order/:patientIdentifier', requireConsent, async (req, res) => {
  try {
    const { patientIdentifier } = req.params;
    const { lat, lng, radius = '10' } = req.query;

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const radiusKm = parseFloat(radius);
    const hasValidCoordinates = !isNaN(userLat) && !isNaN(userLng) && !isNaN(radiusKm);

    if (hasValidCoordinates && (userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180)) {
      return res.status(400).json({ message: 'Invalid latitude or longitude' });
    }

    const prescription = await prisma.prescription.findFirst({
      where: { patientIdentifier, status: { in: ['pending', 'verified'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        PrescriptionMedication: {
          include: {
            Medication: {
              select: { id: true, name: true, dosage: true, form: true, genericName: true, prescriptionRequired: true, nafdacCode: true, imageUrl: true },
            },
          },
        },
      },
    });

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found or not verified' });
    }

    if (prescription.status === 'pending') {
      return res.status(400).json({ message: 'Prescription is still under review. You’ll be notified when it’s ready.' });
    }

    let pharmacyIdsWithDistance = [];
    if (hasValidCoordinates) {
      pharmacyIdsWithDistance = await prisma.$queryRaw`
        SELECT 
          id,
          ST_DistanceSphere(
            location,
            ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326)
          ) / 1000 AS distance_km
        FROM "Pharmacy"
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326),
          ${radiusKm} * 1000
        )
        AND status = 'verified'
        AND "isActive" = true
      `.then((results) =>
        results.map((r) => ({
          id: Number(r.id),
          distance_km: parseFloat(r.distance_km.toFixed(1)),
        }))
      );
    }

    const distanceMap = new Map(
      pharmacyIdsWithDistance.map((entry) => [entry.id, entry.distance_km])
    );

    const medications = await Promise.all(
      prescription.PrescriptionMedication.map(async (prescriptionMed) => {
        const medication = prescriptionMed.Medication;
        const availability = await prisma.pharmacyMedication.findMany({
          where: {
            medicationId: medication.id,
            stock: { gte: prescriptionMed.quantity },
            pharmacy: {
              status: 'verified',
              isActive: true,
              ...(hasValidCoordinates && {
                id: {
                  in: pharmacyIdsWithDistance.length > 0
                    ? pharmacyIdsWithDistance.map((p) => p.id)
                    : [-1],
                },
              }),
            },
          },
          include: {
            pharmacy: { select: { id: true, name: true, address: true } },
          },
        });

        return {
          id: medication.id,
          displayName: `${medication.name}${medication.dosage ? ` ${medication.dosage}` : ''}${medication.form ? ` (${medication.form})` : ''}`,
          quantity: prescriptionMed.quantity,
          genericName: medication.genericName,
          prescriptionRequired: medication.prescriptionRequired,
          nafdacCode: medication.nafdacCode,
          imageUrl: medication.imageUrl,
          availability: availability.map((avail) => ({
            pharmacyId: avail.pharmacy.id,
            pharmacyName: avail.pharmacy.name,
            address: avail.pharmacy.address,
            price: avail.price,
            distance_km: distanceMap.has(avail.pharmacy.id)
              ? distanceMap.get(avail.pharmacy.id)
              : null,
          })),
        };
      })
    );

    const order = await prisma.order.findFirst({
      where: {
        patientIdentifier,
        prescriptionId: prescription.id, // Link order to this prescription
        status: { in: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled'] },
      },
      orderBy: { createdAt: 'desc' }, // Prefer newest order
    });

    res.status(200).json({
      medications,
      prescriptionId: prescription.id,
      orderId: order?.id,
      orderStatus: order?.status,
      prescriptionMetadata: {
        id: prescription.id,
        uploadedAt: prescription.createdAt,
        status: prescription.status,
        fileUrl: prescription.fileUrl,
      },
    });
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