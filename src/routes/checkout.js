const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const prisma = new PrismaClient();

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

    // Find the cart order
    const cartOrder = await prisma.order.findFirst({
      where: { patientIdentifier: userId, status: 'cart' },
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

    // Validate prescription file if required
    if (requiresPrescription && !req.file) {
      return res.status(400).json({ message: 'Prescription file is required for one or more medications' });
    }

    const orders = [];
    let prescription = null;

    // Create prescription if needed
    if (requiresPrescription) {
      const fileUrl = `uploads/${req.file.filename}`; // Replace with S3 URL
      prescription = await prisma.prescription.create({
        data: {
          patientIdentifier: userId,
          fileUrl,
          status: 'pending',
          verified: false,
          createdAt: new Date(),
        },
      });
    }

    // Create orders per pharmacy
    for (const pharmacyId of pharmacyIds) {
      const { items, pharmacy } = itemsByPharmacy[pharmacyId];
      const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const pharmacyRequiresPrescription = items.some(item => {
        const required = item.pharmacyMedication.medication.prescriptionRequired;
        console.log('Item prescription check:', {
          pharmacyId,
          medication: item.pharmacyMedication.medication.name,
          prescriptionRequired: required,
        });
        return required;
      });

      console.log('Creating order for pharmacy:', { pharmacyId, totalPrice, requiresPrescription: pharmacyRequiresPrescription });

      const order = await prisma.$transaction(async (tx) => {
        // Create new order
        const newOrder = await tx.order.create({
          data: {
            patientIdentifier: userId,
            pharmacyId: parseInt(pharmacyId),
            status: pharmacyRequiresPrescription ? 'pending_prescription' : 'pending',
            deliveryMethod,
            address: deliveryMethod === 'delivery' ? address : null,
            email,
            phone: normalizedPhone,
            totalPrice,
            paymentReference: `order_${Date.now()}_${pharmacyId}`,
            paymentStatus: 'pending',
            checkoutSessionId,
            createdAt: new Date(),
            updatedAt: new Date(),
            prescriptionId: pharmacyRequiresPrescription ? prescription?.id : null,
          },
        });

        // Move items to new order
        for (const item of items) {
          await tx.orderItem.create({
            data: {
              orderId: newOrder.id,
              pharmacyMedicationPharmacyId: item.pharmacyMedicationPharmacyId,
              pharmacyMedicationMedicationId: item.pharmacyMedicationMedicationId,
              quantity: item.quantity,
              price: item.price,
            },
          });

          // Reserve stock
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

        return newOrder;
      });

      orders.push({ order, pharmacy, requiresPrescription: pharmacyRequiresPrescription });
    }

    // Delete original cart order and its items
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: cartOrder.id } });
      await tx.order.delete({ where: { id: cartOrder.id } });
    });

    // Handle OTC orders (immediate payment)
    const otcOrders = orders.filter(o => !o.requiresPrescription);
    console.log('OTC orders:', otcOrders.map(o => ({ orderId: o.order.id, pharmacy: o.pharmacy.name, totalPrice: o.order.totalPrice })));
    if (otcOrders.length > 0) {
      const totalOtcAmount = otcOrders.reduce((sum, o) => sum + o.order.totalPrice, 0) * 100;
      const primaryReference = `session_${checkoutSessionId}_${Date.now()}`;

      console.log('Initiating Paystack for OTC orders:', { totalOtcAmount, primaryReference });

      const paystackResponse = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email,
          amount: totalOtcAmount,
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

      // Update OTC orders with primary payment reference
      await prisma.$transaction(async (tx) => {
        for (const otcOrder of otcOrders) {
          await tx.order.update({
            where: { id: otcOrder.order.id },
            data: { paymentReference: primaryReference },
          });
        }
      });

      console.log('Returning OTC payment response:', { checkoutSessionId, paymentReference: primaryReference });

      return res.status(200).json({
        message: 'Checkout initiated for OTC items',
        checkoutSessionId,
        paymentReference: primaryReference,
        paymentUrl: paystackResponse.data.data.authorization_url,
        orders: orders.map(o => ({
          orderId: o.order.id,
          pharmacy: o.pharmacy.name,
          status: o.order.status,
          totalPrice: o.order.totalPrice,
          paymentReference: o.order.paymentReference,
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
      })),
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