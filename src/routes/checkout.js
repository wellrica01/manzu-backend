const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const multer = require('multer');
const router = express.Router();
const prisma = new PrismaClient();

// Configure multer for file uploads (placeholder: replace with S3 or your storage solution)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this directory exists or use S3
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Validate email format
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Validate and normalize phone format (Nigerian phone number check)
const normalizePhone = (phone) => {
  // Remove any non-digit characters except the leading +
  let cleaned = phone.replace(/[^+\d]/g, '');
  
  // Handle local format (e.g., 09031615501 -> +2349031615501)
  if (cleaned.startsWith('0')) {
    cleaned = '+234' + cleaned.slice(1);
  }
  // Handle format without + (e.g., 2349031615501 -> +2349031615501)
  else if (cleaned.startsWith('234')) {
    cleaned = '+' + cleaned;
  }
  
  return cleaned;
};

const isValidPhone = (phone) => {
  // Accepts formats: +234XXXXXXXXXX, 234XXXXXXXXXX, 0XXXXXXXXXX
  const basicFormat = /^(?:\+?234[0-9]{10}|0[0-9]{10})$/;
  if (!basicFormat.test(phone)) return false;

  // Normalize and validate final format
  const normalized = normalizePhone(phone);
  return /^\+234[0-9]{10}$/.test(normalized);
};


router.post('/', upload.single('prescription'), async (req, res) => {
  try {
    const { name, email, phone, address, deliveryMethod } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    if (!userId || !name || !email || !phone || !deliveryMethod) {
      console.error('Missing fields:', { userId, name, email, phone, address, deliveryMethod });
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (!isValidEmail(email)) {
      console.error('Invalid email format:', { email });
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPhone(phone)) {
      console.error('Invalid phone format:', { phone });
      return res.status(400).json({ message: 'Invalid phone number format (e.g., 09031615501 or +2349031615501)' });
    }

    if (!['delivery', 'pickup'].includes(deliveryMethod)) {
      console.error('Invalid delivery method:', { deliveryMethod });
      return res.status(400).json({ message: 'Delivery method must be "delivery" or "pickup"' });
    }

    if (deliveryMethod === 'delivery' && !address) {
      console.error('Address required for delivery:', { userId });
      return res.status(400).json({ message: 'Address is required for delivery' });
    }

    // Normalize phone number for storage
    const normalizedPhone = normalizePhone(phone);

    // Find the cart order with items and medications
    const order = await prisma.order.findFirst({
      where: { patientIdentifier: userId, status: 'cart' },
      include: {
        items: {
          include: {
            pharmacyMedication: {
              include: { medication: true },
            },
          },
        },
      },
    });

    if (!order || order.items.length === 0) {
      console.error('Cart empty or not found:', { userId, order });
      return res.status(400).json({ message: 'Cart is empty or not found' });
    }
    

       // Validate stock availability
    for (const item of order.items) {
      if (item.pharmacyMedication.stock < item.quantity) {
        console.error('Insufficient stock:', {
          medicationId: item.pharmacyMedicationMedicationId,
          pharmacyId: item.pharmacyMedicationPharmacyId,
          stock: item.pharmacyMedication.stock,
          requested: item.quantity,
        });
        return res.status(400).json({
          message: `Insufficient stock for ${item.pharmacyMedication.medication.name}`,
        });
      }
    }

    // Check if any medication requires a prescription
    const requiresPrescription = order.items.some(
      (item) => item.pharmacyMedication.medication.prescriptionRequired
    );

    // Validate prescription file if required
    if (requiresPrescription && !req.file) {
      console.error('Prescription file required:', { userId, orderId: order.id });
      return res.status(400).json({ message: 'Prescription file is required for one or more medications' });
    }

    const reference = `order_${order.id}_${Date.now()}`;

    // Handle prescription-required orders
    if (requiresPrescription) {
      const updatedOrder = await prisma.$transaction(async (tx) => {
        // Create prescription
        const fileUrl = `uploads/${req.file.filename}`; // Replace with S3 URL
        const prescription = await tx.prescription.create({
          data: {
            patientIdentifier: userId,
            fileUrl,
            status: 'pending',
            verified: false,
            createdAt: new Date(),
          },
        });

       // Reserve stock
        for (const item of order.items) {
          await tx.pharmacyMedication.update({
            where: {
              pharmacyId_medicationId: {
                pharmacyId: item.pharmacyMedicationPharmacyId,
                medicationId: item.pharmacyMedicationMedicationId,
              },
            },
            data: {
              stock: { decrement: item.quantity },
            },
          });
        }

        // Update order to pending_prescription
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'pending_prescription',
            patientIdentifier: userId,
            address: deliveryMethod === 'delivery' ? address : null,
            paymentReference: reference,
            paymentStatus: 'pending',
            deliveryMethod,
            email: email || null,
            phone: normalizedPhone,
            prescriptionId: prescription.id,
            updatedAt: new Date(),
          },
        });

        return updatedOrder;
      });

      console.log('Prescription order submitted:', { orderId: updatedOrder.id, paymentReference: reference });

      return res.status(200).json({
        message: 'Prescription submitted, awaiting verification',
        orderId: updatedOrder.id,
        status: 'pending_prescription',
      });
    }

    // Handle OTC-only orders
    const updatedOrder = await prisma.$transaction(async (tx) => {
      
        // Reserve stock
      for (const item of order.items) {
        await tx.pharmacyMedication.update({
          where: {
            pharmacyId_medicationId: {
              pharmacyId: item.pharmacyMedicationPharmacyId,
              medicationId: item.pharmacyMedicationMedicationId,
            },
          },
          data: {
            stock: { decrement: item.quantity },
          },
        });
      }

      // Update order for OTC
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'pending',
          patientIdentifier: userId,
          address: deliveryMethod === 'delivery' ? address : null,
          paymentReference: reference,
          paymentStatus: 'pending',
          email,
          phone: normalizedPhone,
          deliveryMethod,
          updatedAt: new Date(),
        },
      });
      return updatedOrder;
      
    });

    const amount = order.totalPrice * 100; // Paystack expects amount in kobo
    if (amount <= 0) {
      console.error('Invalid amount:', { amount, totalPrice: order.totalPrice });
      return res.status(400).json({ message: 'Invalid cart amount' });
    }

    console.log('Initiating Paystack transaction:', { email, amount, reference });

    // Initiate Paystack transaction
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount,
        reference,
        callback_url: process.env.PAYSTACK_CALLBACK_URL,
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

    console.log('OTC order updated:', { orderId: updatedOrder.id, paymentReference: reference });

    res.status(200).json({
      message: 'Checkout initiated',
      paymentReference: reference,
      paymentUrl: paystackResponse.data.data.authorization_url,
    });
  } catch (error) {
    console.error('Checkout error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/resume/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { email } = req.body;
    const userId = req.headers['x-guest-id'];

    // Validate input
    if (!orderId || !userId || !email) {
      console.error('Missing fields:', { orderId, userId, email });
      return res.status(400).json({ message: 'Order ID, guest ID, and email are required' });
    }

    if (!isValidEmail(email)) {
      console.error('Invalid email format:', { email });
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Find the order
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
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

    if (!order || order.patientIdentifier !== userId || order.status !== 'pending_prescription') {
      console.error('Order not found or invalid:', { orderId, userId, order });
      return res.status(400).json({ message: 'Order not found or not in pending prescription state' });
    }

    // Check if prescription is required and verified
    const requiresPrescription = order.items.some(
      (item) => item.pharmacyMedication.medication.prescriptionRequired
    );

    if (requiresPrescription && (!order.prescription || order.prescription.status !== 'verified')) {
      console.error('Prescription not verified:', { orderId, prescription: order.prescription });
      return res.status(400).json({ message: 'Prescription not verified' });
    }

    const amount = order.totalPrice * 100; // Paystack expects amount in kobo
    if (amount <= 0) {
      console.error('Invalid amount:', { amount, totalPrice: order.totalPrice });
      return res.status(400).json({ message: 'Invalid order amount' });
    }

    const reference = order.paymentReference || `order_${order.id}_${Date.now()}`;
    console.log('Initiating Paystack transaction for resumed order:', { email, amount, reference });

    // Initiate Paystack transaction
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount,
        reference,
        callback_url: process.env.PAYSTACK_CALLBACK_URL,
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

    // Update order to pending
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

    console.log('Resumed order updated:', { orderId: updatedOrder.id, paymentReference: reference });

    res.status(200).json({
      message: 'Checkout resumed',
      paymentReference: reference,
      paymentUrl: paystackResponse.data.data.authorization_url,
    });
  } catch (error) {
    console.error('Checkout resume error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;