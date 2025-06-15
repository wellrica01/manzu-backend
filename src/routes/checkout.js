const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const prisma = new PrismaClient();
const requireConsent = require('../middleware/requireConsent');


// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only PDF, JPEG, or PNG files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Validate email
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Validate and normalize phone
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

router.post('/', upload.single('prescription'), requireConsent, async (req, res) => {
  try {
    const { name, email, phone, address, deliveryMethod } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    if (!userId || !name || !email || !phone || !deliveryMethod) {
      console.error('Missing fields:', { userId, name, email, phone, address, deliveryMethod });
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: 'Invalid phone number format (e.g., 09031615501 or +2349031615501)' });
    }

    if (!['delivery', 'pickup'].includes(deliveryMethod)) {
      return res.status(400).json({ message: 'Delivery method must be "delivery" or "pickup"' });
    }

    if (deliveryMethod === 'delivery' && !address) {
      return res.status(400).json({ message: 'Address is required for delivery' });
    }

    const normalizedPhone = normalizePhone(phone);

    const patientIdentifier = userId;

    // Find the cart order
    const cartOrder = await prisma.order.findFirst({
      where: { patientIdentifier, status: 'cart' },
      include: {
        items: {
          include: {
            pharmacyMedication: {
              include: { medication: true, pharmacy: true },
            },
          },
        },
      },
    });

    if (!cartOrder || cartOrder.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty or not found' });
    }

    // Group items by pharmacy
    const itemsByPharmacy = cartOrder.items.reduce((acc, item) => {
      const pharmacyId = item.pharmacyMedicationPharmacyId;
      if (!acc[pharmacyId]) {
        acc[pharmacyId] = { items: [], pharmacy: item.pharmacyMedication.pharmacy };
      }
      acc[pharmacyId].items.push(item);
      return acc;
    }, {});

    const pharmacyIds = Object.keys(itemsByPharmacy);
    const checkoutSessionId = uuidv4();

    // Validate stock and prescription requirements
    let requiresPrescription = false;
    for (const pharmacyId of pharmacyIds) {
      const { items } = itemsByPharmacy[pharmacyId];
      for (const item of items) {
        if (item.pharmacyMedication.stock < item.quantity) {
          return res.status(400).json({
            message: `Insufficient stock for ${item.pharmacyMedication.medication.name}`,
          });
        }
        if (item.pharmacyMedication.medication.prescriptionRequired) {
          requiresPrescription = true;
        }
      }
    }

    let verifiedPrescription = null;
    let newPrescription = null;

    if (requiresPrescription) {
      // Check for existing verified prescription
      verifiedPrescription = await prisma.prescription.findFirst({
        where: {
          patientIdentifier,
          status: 'verified',
        },
        include: { PrescriptionMedication: true },
        orderBy: [{ createdAt: 'desc' }],
      });

      const orderMedicationIds = cartOrder.items
        .filter(item => item.pharmacyMedication.medication.prescriptionRequired)
        .map(item => item.pharmacyMedication.medicationId);

      let isValidPrescription = false;
      if (verifiedPrescription) {
        const prescriptionMedicationIds = verifiedPrescription.PrescriptionMedication.map(pm => pm.medicationId);
        isValidPrescription = orderMedicationIds.every(id => prescriptionMedicationIds.includes(id));
      }

      if (!isValidPrescription) {
        if (req.file) {
          // Create new prescription for uncovered medications
          const fileUrl = `uploads/${req.file.filename}`;
          newPrescription = await prisma.prescription.create({
            data: {
              patientIdentifier,
              fileUrl,
              status: 'pending',
              verified: false,
              email,
              phone: normalizedPhone,
              createdAt: new Date(),
            },
          });
          // Link uncovered medications to new prescription
          const uncoveredMedicationIds = verifiedPrescription
            ? orderMedicationIds.filter(id => !verifiedPrescription.PrescriptionMedication.map(pm => pm.medicationId).includes(id))
            : orderMedicationIds;
          const prescriptionItems = uncoveredMedicationIds.map(medicationId => ({
            prescriptionId: newPrescription.id,
            medicationId,
            quantity: cartOrder.items.find(item => item.pharmacyMedication.medicationId === medicationId)?.quantity || 1,
          }));
          if (prescriptionItems.length > 0) {
            await prisma.prescriptionMedication.createMany({ data: prescriptionItems });
          }
        } else if (!verifiedPrescription) {
          return res.status(400).json({
            message: 'Prescription file is required for one or more medications',
          });
        } else {
          return res.status(400).json({
            message: 'Existing prescription does not cover all required medications, and no new prescription uploaded',
          });
        }
      }
    }

    const orders = [];

    // Create orders per pharmacy, splitting by prescription coverage
    for (const pharmacyId of pharmacyIds) {
      const { items, pharmacy } = itemsByPharmacy[pharmacyId];
      const coveredItems = verifiedPrescription
        ? items.filter(item => item.pharmacyMedication.medication.prescriptionRequired &&
            verifiedPrescription.PrescriptionMedication.map(pm => pm.medicationId).includes(item.pharmacyMedication.medicationId))
        : [];
      const uncoveredItems = newPrescription
        ? items.filter(item => item.pharmacyMedication.medication.prescriptionRequired &&
            !verifiedPrescription?.PrescriptionMedication.map(pm => pm.medicationId).includes(item.pharmacyMedication.medicationId))
        : [];
      const otcItems = items.filter(item => !item.pharmacyMedication.medication.prescriptionRequired);

      // Create order for covered items (verified prescription)
      if (coveredItems.length > 0) {
        const totalPrice = coveredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderStatus = 'pending'; // Payable since prescription is verified
        const order = await prisma.$transaction(async (tx) => {
          const newOrder = await tx.order.create({
            data: {
              patientIdentifier,
              pharmacyId: parseInt(pharmacyId),
              status: orderStatus,
              deliveryMethod,
              address: deliveryMethod === 'delivery' ? address : null,
              email,
              phone: normalizedPhone,
              totalPrice,
              paymentReference: `order_${Date.now()}_${pharmacyId}_verified`,
              paymentStatus: 'pending',
              checkoutSessionId,
              createdAt: new Date(),
              updatedAt: new Date(),
              prescriptionId: verifiedPrescription.id,
            },
          });

          for (const item of coveredItems) {
            await tx.orderItem.create({
              data: {
                orderId: newOrder.id,
                pharmacyMedicationPharmacyId: item.pharmacyMedicationPharmacyId,
                pharmacyMedicationMedicationId: item.pharmacyMedication.medicationId,
                quantity: item.quantity,
                price: item.price,
              },
            });

            await tx.pharmacyMedication.update({
              where: {
                pharmacyId_medicationId: {
                  pharmacyId: item.pharmacyMedicationPharmacyId,
                  medicationId: item.pharmacyMedication.medicationId,
                },
              },
              data: {
                stock: { decrement: item.quantity },
              },
            });
          }

          return newOrder;
        });
        orders.push({ order, pharmacy, requiresPrescription: true });
      }

      // Create order for uncovered items (new prescription)
      if (uncoveredItems.length > 0) {
        const totalPrice = uncoveredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderStatus = 'pending_prescription';
        const order = await prisma.$transaction(async (tx) => {
          const newOrder = await tx.order.create({
            data: {
              patientIdentifier,
              pharmacyId: parseInt(pharmacyId),
              status: orderStatus,
              deliveryMethod,
              address: deliveryMethod === 'delivery' ? address : null,
              email,
              phone: normalizedPhone,
              totalPrice,
              paymentReference: `order_${Date.now()}_${pharmacyId}_new`,
              paymentStatus: 'pending',
              checkoutSessionId,
              createdAt: new Date(),
              updatedAt: new Date(),
              prescriptionId: newPrescription.id,
            },
          });

          for (const item of uncoveredItems) {
            await tx.orderItem.create({
              data: {
                orderId: newOrder.id,
                pharmacyMedicationPharmacyId: item.pharmacyMedicationPharmacyId,
                pharmacyMedicationMedicationId: item.pharmacyMedication.medicationId,
                quantity: item.quantity,
                price: item.price,
              },
            });

            await tx.pharmacyMedication.update({
              where: {
                pharmacyId_medicationId: {
                  pharmacyId: item.pharmacyMedicationPharmacyId,
                  medicationId: item.pharmacyMedication.medicationId,
                },
              },
              data: {
                stock: { decrement: item.quantity },
              },
            });
          }

          return newOrder;
        });
        orders.push({ order, pharmacy, requiresPrescription: true });
      }

      // Create order for OTC items
      if (otcItems.length > 0) {
        const totalPrice = otcItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderStatus = 'pending';
        const order = await prisma.$transaction(async (tx) => {
          const newOrder = await tx.order.create({
            data: {
              patientIdentifier,
              pharmacyId: parseInt(pharmacyId),
              status: orderStatus,
              deliveryMethod,
              address: deliveryMethod === 'delivery' ? address : null,
              email,
              phone: normalizedPhone,
              totalPrice,
              paymentReference: `order_${Date.now()}_${pharmacyId}_otc`,
              paymentStatus: 'pending',
              checkoutSessionId,
              createdAt: new Date(),
              updatedAt: new Date(),
              prescriptionId: null,
            },
          });

          for (const item of otcItems) {
            await tx.orderItem.create({
              data: {
                orderId: newOrder.id,
                pharmacyMedicationPharmacyId: item.pharmacyMedicationPharmacyId,
                pharmacyMedicationMedicationId: item.pharmacyMedication.medicationId,
                quantity: item.quantity,
                price: item.price,
              },
            });

            await tx.pharmacyMedication.update({
              where: {
                pharmacyId_medicationId: {
                  pharmacyId: item.pharmacyMedicationPharmacyId,
                  medicationId: item.pharmacyMedication.medicationId,
                },
              },
              data: {
                stock: { decrement: item.quantity },
              },
            });
          }

          return newOrder;
        });
        orders.push({ order, pharmacy, requiresPrescription: false });
      }
    }

    // Delete original cart order and its items
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: cartOrder.id } });
      await tx.order.delete({ where: { id: cartOrder.id } });
    });

    // Handle payable orders (OTC and verified prescription orders)
    const payableOrders = orders.filter(o => o.order.status === 'pending');
    console.log('Payable orders:', payableOrders.map(o => ({ orderId: o.order.id, pharmacy: o.pharmacy.name, totalPrice: o.order.totalPrice })));
    if (payableOrders.length > 0) {
      const totalPayableAmount = payableOrders.reduce((sum, o) => sum + o.order.totalPrice, 0) * 100;
      const primaryReference = `session_${checkoutSessionId}_${Date.now()}`;

      console.log('Initiating Paystack for payable orders:', { totalPayableAmount, primaryReference });

      const paystackResponse = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email,
          amount: totalPayableAmount,
          reference: primaryReference,
          callback_url: `${process.env.PAYSTACK_CALLBACK_URL}?session=${checkoutSessionId}`,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!paystackResponse.data.status) {
        console.error('Paystack initialization failed:', paystackResponse.data);
        return res.status(500).json({ message: 'Failed to initialize payment', error: paystackResponse.data });
      }

      console.log('Returning payment response:', { checkoutSessionId, paymentReference: primaryReference });

      return res.status(200).json({
        message: 'Checkout initiated for payable items',
        checkoutSessionId,
        paymentReference: primaryReference,
        paymentUrl: paystackResponse.data.data.authorization_url,
        orders: orders.map(o => ({
          orderId: o.order.id,
          pharmacy: o.pharmacy.name,
          status: o.order.status,
          totalPrice: o.order.totalPrice,
          paymentReference: o.order.paymentReference,
          prescriptionId: o.order.prescriptionId,
        })),
      });
    }

    // Handle prescription-only orders
    console.log('Returning prescription-only response:', { checkoutSessionId });
    return res.status(200).json({
      message: 'Prescription submitted, awaiting verification',
      checkoutSessionId,
      orders: orders.map(o => ({
        orderId: o.order.id,
        pharmacy: o.pharmacy.name,
        status: o.order.status,
        totalPrice: o.order.totalPrice,
        prescriptionId: o.order.prescriptionId,
      })),
    });
  } catch (error) {
    console.error('Checkout error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add session retrieval endpoint
router.post('/session/retrieve', requireConsent, async (req, res) => {
  try {
    const { email, phone, checkoutSessionId } = req.body;
    const userId = req.headers['x-guest-id'];
    if (!email && !phone && !checkoutSessionId) {
      return res.status(400).json({ message: 'Email, phone, or checkoutSessionId required' });
    }
    let session;
    if (email || phone) {
      session = await prisma.order.findFirst({
        where: {
          patientIdentifier: userId,
          OR: [{ email }, { phone }],
        },
        select: { patientIdentifier: true, checkoutSessionId: true },
      }) || await prisma.prescription.findFirst({
        where: {
          patientIdentifier: userId,
          OR: [{ email }, { phone }],
        },
        select: { patientIdentifier: true },
      }) || await prisma.order.findFirst({
        where: {
          OR: [{ email }, { phone }],
          patientIdentifier: { not: null },
        },
        select: { patientIdentifier: true, checkoutSessionId: true },
      }) || await prisma.prescription.findFirst({
        where: {
          OR: [{ email }, { phone }],
          patientIdentifier: { not: null },
        },
        select: { patientIdentifier: true },
      });
    } else if (checkoutSessionId) {
      session = await prisma.order.findFirst({
        where: { checkoutSessionId, patientIdentifier: { not: null } },
        select: { patientIdentifier: true, checkoutSessionId: true },
      });
    }
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.status(200).json({
      guestId: session.patientIdentifier,
      checkoutSessionId: session.checkoutSessionId || null,
    });
  } catch (error) {
    console.error('Session retrieval error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add prescription validation endpoint
router.get('/prescription/validate', async (req, res) => {
  try {
    const { patientIdentifier, medicationIds } = req.query;
    if (!patientIdentifier) {
      return res.status(400).json({ message: 'patientIdentifier required' });
    }
    if (!medicationIds) {
      return res.status(200).json({ requiresUpload: true });
    }
    const ids = medicationIds.split(',').map(Number).filter(id => !isNaN(id));
    if (ids.length === 0) {
      return res.status(200).json({ requiresUpload: true });
    }
    const prescription = await prisma.prescription.findFirst({
      where: { patientIdentifier, status: 'verified' },
      include: { PrescriptionMedication: true },
    });
    if (!prescription) {
      return res.status(200).json({ requiresUpload: true });
    }
    const prescriptionMedicationIds = prescription.PrescriptionMedication.map(pm => pm.medicationId);
    console.log('Prescription medication IDs:', prescriptionMedicationIds);
    const isValid = ids.every(id => prescriptionMedicationIds.includes(id));
    res.status(200).json({ requiresUpload: !isValid });
  } catch (error) {
    console.error('Prescription validation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Resume endpoint
router.post('/resume/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { email } = req.body;
    const userId = req.headers['x-guest-id'];

    if (!orderId || !userId || !email) {
      return res.status(400).json({ message: 'Order ID, guest ID, and email are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      include: {
        items: {
          include: {
            pharmacyMedication: {
              include: { medication: true, pharmacy: true },
            },
          },
        },
        prescription: true,
      },
    });

    if (!order || order.patientIdentifier !== userId || order.status !== 'pending_prescription') {
      return res.status(400).json({ message: 'Order not found or not in pending prescription state' });
    }

    const requiresPrescription = order.items.some(
      (item) => item.pharmacyMedication.medication.prescriptionRequired
    );

    if (requiresPrescription && (!order.prescription || order.prescription.status !== 'verified')) {
      return res.status(400).json({ message: 'Prescription not verified' });
    }

    const amount = order.totalPrice * 100;
    if (amount <= 0) {
      return res.status(400).json({ message: 'Invalid order amount' });
    }

    const reference = `order_${order.id}_${Date.now()}`;

    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount,
        reference,
        callback_url: `${process.env.PAYSTACK_CALLBACK_URL}?session=${order.checkoutSessionId}`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!paystackResponse.data.status) {
      return res.status(500).json({ message: 'Failed to initialize payment', error: paystackResponse.data });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id: parseInt(orderId) },
        data: {
          status: 'pending',
          paymentReference: reference,
          paymentStatus: 'pending',
          updatedAt: new Date(),
        },
      });
      return order;
    });

    res.status(200).json({
      message: 'Checkout resumed',
      checkoutSessionId: updatedOrder.checkoutSessionId,
      paymentReference: reference,
      paymentUrl: paystackResponse.data.data.authorization_url,
    });
  } catch (error) {
    console.error('Checkout resume error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;