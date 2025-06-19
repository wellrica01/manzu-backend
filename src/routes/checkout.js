const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const prisma = new PrismaClient();
const requireConsent = require('../middleware/requireConsent');

console.log('Loaded checkout.js version: 2025-06-18-v2');

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
    const paymentReferences = [];

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

      if (coveredItems.length > 0) {
        const totalPrice = coveredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderStatus = 'pending';
        const paymentReference = `order_${Date.now()}_${pharmacyId}_verified`;
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
              paymentReference,
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
        paymentReferences.push(paymentReference);
      }

      if (uncoveredItems.length > 0) {
        const totalPrice = uncoveredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderStatus = 'pending_prescription';
        const paymentReference = `order_${Date.now()}_${pharmacyId}_new`;
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
              paymentReference,
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

      if (otcItems.length > 0) {
        const totalPrice = otcItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderStatus = 'pending';
        const paymentReference = `order_${Date.now()}_${pharmacyId}_otc`;
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
              paymentReference,
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
        paymentReferences.push(paymentReference);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: cartOrder.id } });
      await tx.order.delete({ where: { id: cartOrder.id } });
    });

    const payableOrders = orders.filter(o => o.order.status === 'pending');
    console.log('Payable orders:', payableOrders.map(o => ({ orderId: o.order.id, pharmacy: o.pharmacy.name, totalPrice: o.order.totalPrice })));
    if (payableOrders.length > 0) {
      const totalPayableAmount = payableOrders.reduce((sum, o) => sum + o.order.totalPrice, 0) * 100;
      const transactionReference = `session_${checkoutSessionId}_${Date.now()}`;

      console.log('Initiating Paystack for payable orders:', { totalPayableAmount, transactionReference });

      const paystackResponse = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email,
          amount: totalPayableAmount,
          reference: transactionReference,
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

      await prisma.transactionReference.create({
        data: {
          transactionReference,
          orderReferences: paymentReferences,
          checkoutSessionId,
          createdAt: new Date(),
        },
      });

      console.log('Returning payment response:', { checkoutSessionId, transactionReference, paymentReferences });

      return res.status(200).json({
        message: 'Checkout initiated for payable items',
        checkoutSessionId,
        transactionReference,
        paymentReferences,
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
    console.log('Session retrieve input:', { email, phone, checkoutSessionId });

    if (!email && !phone && !checkoutSessionId) {
      return res.status(400).json({ message: 'Email, phone, or checkoutSessionId required' });
    }

    let guestId = null;

    if (checkoutSessionId) {
      console.log('Checking order by checkoutSessionId:', checkoutSessionId);
      const order = await prisma.order.findFirst({
        where: { checkoutSessionId },
        select: { patientIdentifier: true },
      });
      if (order) {
        guestId = order.patientIdentifier;
        console.log('Found guestId by checkoutSessionId:', guestId);
      }
    } else if (email || phone) {
      // Build OR clause only with defined values
      const orConditions = [];
      if (email) orConditions.push({ email });
      if (phone) orConditions.push({ phone });

      console.log('OR conditions:', JSON.stringify(orConditions));

      // Define queries explicitly
      const orderQuery = {
        where: {
          ...(orConditions.length > 0 && { OR: orConditions }),
        },
        select: { patientIdentifier: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      };
      const prescriptionQuery = {
        where: {
          ...(orConditions.length > 0 && { OR: orConditions }),
        },
        select: { patientIdentifier: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      };

      console.log('Order query:', JSON.stringify(orderQuery));
      console.log('Prescription query:', JSON.stringify(prescriptionQuery));

      // Prioritize most recent order or prescription
      const [order, prescription] = await prisma.$transaction([
        prisma.order.findFirst(orderQuery),
        prisma.prescription.findFirst(prescriptionQuery),
      ]);

      console.log('Order result:', order);
      console.log('Prescription result:', prescription);

      // Choose the more recent record
      if (order && prescription) {
        guestId = order.createdAt > prescription.createdAt ? order.patientIdentifier : prescription.patientIdentifier;
        console.log('Selected guestId (order vs prescription):', guestId);
      } else {
        guestId = order?.patientIdentifier || prescription?.patientIdentifier;
        console.log('Selected guestId (single result):', guestId);
      }
    }

    if (!guestId) {
      console.log('No guestId found for input:', { email, phone, checkoutSessionId });
      return res.status(404).json({ message: 'Session not found' });
    }

    res.status(200).json({ guestId });
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


// GET resume endpoint to fetch session details
router.get('/resume/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.headers['x-guest-id'];

    if (!orderId || !userId) {
      console.error('Missing required fields:', { orderId, userId });
      return res.status(400).json({ message: 'Order ID and guest ID are required' });
    }

    // Fetch the order to get checkoutSessionId and ensure it has a prescription
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      select: {
        checkoutSessionId: true,
        patientIdentifier: true,
        email: true,
        prescriptionId: true,
      },
    });

    if (!order || order.patientIdentifier !== userId || !order.prescriptionId) {
      console.warn('Order not found, unauthorized, or has no prescription:', { orderId, userId, prescriptionId: order?.prescriptionId });
      return res.status(404).json({ message: 'Order not found, unauthorized, or not linked to a prescription' });
    }

    // Verify the prescription's patientIdentifier
    const prescription = await prisma.prescription.findUnique({
      where: { id: order.prescriptionId },
      select: { patientIdentifier: true },
    });

    if (!prescription || prescription.patientIdentifier !== userId) {
      console.warn('Prescription not found or mismatched patientIdentifier:', { prescriptionId: order.prescriptionId, userId });
      return res.status(404).json({ message: 'Prescription not found or not linked to the same patient' });
    }

    // Fetch all orders in the session with a valid prescription
    const sessionOrders = await prisma.order.findMany({
      where: {
        checkoutSessionId: order.checkoutSessionId,
        patientIdentifier: userId,
        prescriptionId: { not: null }, // Ensure prescriptionId is not null
        prescription: {
          patientIdentifier: userId, // Ensure the linked prescription has the same patientIdentifier
        },
      },
      select: {
        id: true,
        totalPrice: true,
        status: true,
        prescriptionId: true,
      },
    });

    if (sessionOrders.length === 0) {
      console.warn('No orders in session with valid prescription:', { checkoutSessionId: order.checkoutSessionId, userId });
      return res.status(404).json({ message: 'No orders found in this session with a valid prescription' });
    }

    // Calculate total amount for pending orders
    const totalAmount = sessionOrders
      .filter(o => o.status === 'pending')
      .reduce((sum, o) => sum + o.totalPrice, 0);

    console.log('Session details retrieved:', { orderId, userId, checkoutSessionId: order.checkoutSessionId, totalAmount });

    res.status(200).json({
      message: 'Session details retrieved',
      checkoutSessionId: order.checkoutSessionId,
      totalAmount,
      email: order.email || null,
      orders: sessionOrders.map(o => ({
        orderId: o.id,
        totalPrice: o.totalPrice,
        status: o.status,
        prescriptionId: o.prescriptionId,
      })),
    });
  } catch (error) {
    console.error('Checkout resume GET error:', { message: error.message, stack: error.stack });
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
      console.error('Missing required fields:', { orderId, userId, email });
      return res.status(400).json({ message: 'Order ID, guest ID, and email are required' });
    }

    if (!isValidEmail(email)) {
      console.error('Invalid email format:', { email });
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

    if (!order || order.patientIdentifier !== userId) {
      console.warn('Order not found or unauthorized:', { orderId, userId });
      return res.status(404).json({ message: 'Order not found or unauthorized' });
    }

    const sessionOrders = await prisma.order.findMany({
      where: {
        checkoutSessionId: order.checkoutSessionId,
        patientIdentifier: userId,
        status: 'pending',
      },
      include: {
        items: {
          include: {
            pharmacyMedication: {
              include: { medication: true },
            },
          },
        },
        prescription: true,
      },
    });

    if (sessionOrders.length === 0) {
      console.warn('No pending orders in session:', { checkoutSessionId: order.checkoutSessionId, userId });
      return res.status(400).json({ message: 'No orders awaiting payment in this session' });
    }

    for (const sessionOrder of sessionOrders) {
      const requiresPrescription = sessionOrder.items.some(
        item => item.pharmacyMedication.medication.prescriptionRequired
      );
      if (requiresPrescription && (!sessionOrder.prescription || sessionOrder.prescription.status !== 'verified')) {
        console.warn('Unverified prescription for order:', { orderId: sessionOrder.id });
        return res.status(400).json({ message: `Prescription not verified for order ${sessionOrder.id}` });
      }
    }

    const totalAmount = sessionOrders.reduce((sum, o) => sum + o.totalPrice, 0) * 100;
    if (totalAmount <= 0) {
      console.error('Invalid total amount:', { totalAmount, checkoutSessionId: order.checkoutSessionId });
      return res.status(400).json({ message: 'Invalid order amount' });
    }

    const transactionReference = `session_${order.checkoutSessionId}_${Date.now()}`;
    const paymentReferences = [];

    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: totalAmount,
        reference: transactionReference,
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
      console.error('Paystack initialization failed:', paystackResponse.data);
      return res.status(500).json({ message: 'Failed to initialize payment', error: paystackResponse.data });
    }

    await prisma.$transaction(async (tx) => {
      for (const sessionOrder of sessionOrders) {
        const orderSpecificReference = `order_${sessionOrder.id}_${order.checkoutSessionId}_${Date.now()}`;
        await tx.order.update({
          where: { id: sessionOrder.id },
          data: {
            paymentReference: orderSpecificReference,
            paymentStatus: 'pending',
            updatedAt: new Date(),
          },
        });
        paymentReferences.push(orderSpecificReference);
      }
      await tx.transactionReference.create({
        data: {
          transactionReference,
          orderReferences: paymentReferences,
          checkoutSessionId: order.checkoutSessionId,
          createdAt: new Date(),
        },
      });
    });

    console.log('Checkout resumed for session:', { orderId, userId, checkoutSessionId: order.checkoutSessionId, totalAmount, transactionReference, paymentReferences });

    res.status(200).json({
      message: 'Checkout resumed for session',
      checkoutSessionId: order.checkoutSessionId,
      transactionReference,
      paymentReferences,
      paymentUrl: paystackResponse.data.data.authorization_url,
      totalAmount: totalAmount / 100,
      orders: sessionOrders.map(o => ({
        orderId: o.id,
        totalPrice: o.totalPrice,
        status: o.status,
        paymentReference: o.paymentReference,
      })),
    });
  } catch (error) {
    console.error('Checkout resume error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/resume-orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.headers['x-guest-id'];

    if (!orderId || !userId) {
      return res.status(400).json({ message: 'Order ID and guest ID are required' });
    }

    // Validate the initial order
    const initialOrder = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      select: { checkoutSessionId: true, patientIdentifier: true, prescriptionId: true, status: true },
    });

    if (!initialOrder || initialOrder.patientIdentifier !== userId || !initialOrder.prescriptionId || initialOrder.status !== 'pending') {
      return res.status(404).json({ message: 'Order not found, unauthorized, not linked to a prescription, or not pending' });
    }

    // Fetch pending orders with the same checkoutSessionId and prescriptionId
    const orders = await prisma.order.findMany({
      where: {
        checkoutSessionId: initialOrder.checkoutSessionId,
        patientIdentifier: userId,
        prescriptionId: initialOrder.prescriptionId,
        status: 'pending',
      },
      include: {
        items: {
          include: {
            pharmacyMedication: { include: { medication: true, pharmacy: true } },
          },
        },
        prescription: true,
        pharmacy: true,
      },
    });

    if (!orders.length) {
      return res.status(404).json({ message: 'No pending orders found for this session' });
    }

    // Format response to match the structure expected by the frontend
    const pharmacies = orders.reduce((acc, order) => {
      const pharmacyId = order.pharmacyId;
      const existing = acc.find(p => p.pharmacy.id === pharmacyId);
      const orderData = {
        id: order.id,
        totalPrice: order.totalPrice,
        status: order.status,
        email: order.email || null,
        prescription: order.prescription
          ? { id: order.prescription.id, status: order.prescription.status, uploadedAt: order.prescription.uploadedAt }
          : null,
        items: order.items.map(item => ({
          id: item.id,
          quantity: item.quantity,
          price: item.price,
          medication: { id: item.pharmacyMedication.medication.id, name: item.pharmacyMedication.medication.name },
        })),
      };

      if (existing) {
        existing.orders.push(orderData);
      } else {
        acc.push({
          pharmacy: { id: order.pharmacy.id, name: order.pharmacy.name, address: order.pharmacy.address },
          orders: [orderData],
        });
      }
      return acc;
    }, []);

    res.status(200).json({
      pharmacies,
      trackingCode: orders[0].trackingCode || 'Pending',
    });
  } catch (error) {
    console.error('Resume orders fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;