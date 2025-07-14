const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('../utils/validation');
const prisma = new PrismaClient();

async function initiateCheckout({ name, email, phone, address, deliveryMethod, userId }) {
  const patientIdentifier = userId;
  const normalizedPhone = normalizePhone(phone);

  // Find all orders that contain ready medications (cart status + pending status for verified prescriptions)
  const cartOrders = await prisma.order.findMany({
    where: { 
      patientIdentifier, 
      status: { in: ['cart', 'pending'] } // Include both cart and pending orders
    },
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

  if (!cartOrders || cartOrders.length === 0) {
    throw new Error('Cart is empty or not found');
  }

  // Filter out items that are not ready for checkout
  // Only include OTC items and prescription items with verified prescriptions
  const readyItems = [];
  
  for (const order of cartOrders) {
    for (const item of order.items) {
      const isOTC = !item.pharmacyMedication.medication.prescriptionRequired;
      const isVerifiedPrescription = item.pharmacyMedication.medication.prescriptionRequired && 
                                   order.status === 'pending' && 
                                   order.prescriptionId;
      
      if (isOTC || isVerifiedPrescription) {
        readyItems.push({
          ...item,
          orderId: order.id,
          orderStatus: order.status
        });
      }
    }
  }

  if (readyItems.length === 0) {
    throw new Error('No medications ready for checkout');
  }

  // Group items by pharmacy
  const itemsByPharmacy = readyItems.reduce((acc, item) => {
    const pharmacyId = item.pharmacyMedicationPharmacyId;
    if (!acc[pharmacyId]) {
      acc[pharmacyId] = { items: [], pharmacy: item.pharmacyMedication.pharmacy };
    }
    acc[pharmacyId].items.push(item);
    return acc;
  }, {});

  const pharmacyIds = Object.keys(itemsByPharmacy);
  const checkoutSessionId = uuidv4();

  // Validate stock and ensure all medications are ready for checkout
  for (const pharmacyId of pharmacyIds) {
    const { items } = itemsByPharmacy[pharmacyId];
    for (const item of items) {
      if (item.pharmacyMedication.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${item.pharmacyMedication.medication.name}`);
      }
      
      // Check if prescription medications have verified prescriptions
      if (item.pharmacyMedication.medication.prescriptionRequired) {
        const verifiedPrescription = await prisma.prescription.findFirst({
          where: { 
            patientIdentifier, 
            status: 'verified',
            PrescriptionMedication: {
              some: {
                medicationId: item.pharmacyMedication.medicationId
              }
            }
          },
        });
        
        if (!verifiedPrescription) {
          throw new Error(`Prescription required for ${item.pharmacyMedication.medication.name} but not verified`);
        }
      }
    }
  }

  const orders = [];
  const paymentReferences = [];

  for (const pharmacyId of pharmacyIds) {
    const { items, pharmacy } = itemsByPharmacy[pharmacyId];
    const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderStatus = 'pending';
    const paymentReference = `order_${Date.now()}_${pharmacyId}`;
    
    const newOrder = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
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
          prescriptionId: null, // Prescriptions are handled at cart level
        },
      });

      for (const item of items) {
        await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
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

      return createdOrder;
    });
    
    orders.push({ order: newOrder, pharmacy });
    paymentReferences.push(paymentReference);
  }

  // Clean up the original orders by removing the items that were moved to checkout
  await prisma.$transaction(async (tx) => {
    for (const item of readyItems) {
      await tx.orderItem.delete({
        where: { id: item.id }
      });
    }
    
    // Delete empty orders
    for (const originalOrder of cartOrders) {
      const remainingItems = await tx.orderItem.count({
        where: { orderId: originalOrder.id }
      });
      
      if (remainingItems === 0) {
        await tx.order.delete({
          where: { id: originalOrder.id }
        });
      }
    }
  });

  const totalPayableAmount = orders.reduce((sum, o) => sum + o.order.totalPrice, 0) * 100;
  const transactionReference = `session_${checkoutSessionId}_${Date.now()}`;

  console.log('Initiating Paystack for orders:', { totalPayableAmount, transactionReference });

  // Paystack requires an email, so we'll use a placeholder if none provided
  const paystackEmail = email || `guest-${patientIdentifier}@manzu.com`;
  
  const callbackUrl = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/med-confirmation/callback?session=${checkoutSessionId}`;
  console.log('Callback URL:', callbackUrl);
  
  const paystackResponse = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email: paystackEmail,
      amount: totalPayableAmount,
      reference: transactionReference,
      callback_url: callbackUrl,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!paystackResponse.data.status) {
    throw new Error('Failed to initialize payment: ' + JSON.stringify(paystackResponse.data));
  }

  console.log('Creating TransactionReference:', {
    transactionReference,
    orderReferences: paymentReferences,
    checkoutSessionId
  });
  
  try {
    await prisma.transactionReference.create({
      data: {
        transactionReference,
        orderReferences: paymentReferences,
        checkoutSessionId,
        createdAt: new Date(),
      },
    });
    console.log('TransactionReference created successfully');
  } catch (error) {
    console.error('Error creating TransactionReference:', error);
    throw new Error('Failed to create transaction reference: ' + error.message);
  }

  return {
    message: 'Checkout initiated successfully',
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
    })),
  };
}

async function retrieveSession({ email, phone, checkoutSessionId }) {
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
    const orConditions = [];
    if (email) orConditions.push({ email });
    if (phone) orConditions.push({ phone: normalizePhone(phone) });

    console.log('OR conditions:', JSON.stringify(orConditions));

    const orderQuery = {
      where: { ...(orConditions.length > 0 && { OR: orConditions }) },
      select: { patientIdentifier: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    };
    const prescriptionQuery = {
      where: { ...(orConditions.length > 0 && { OR: orConditions }) },
      select: { patientIdentifier: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    };

    console.log('Order query:', JSON.stringify(orderQuery));
    console.log('Prescription query:', JSON.stringify(prescriptionQuery));

    const [order, prescription] = await prisma.$transaction([
      prisma.order.findFirst(orderQuery),
      prisma.prescription.findFirst(prescriptionQuery),
    ]);

    console.log('Order result:', order);
    console.log('Prescription result:', prescription);

    if (order && prescription) {
      guestId = order.createdAt > prescription.createdAt ? order.patientIdentifier : prescription.patientIdentifier;
      console.log('Selected guestId (order vs prescription):', guestId);
    } else {
      guestId = order?.patientIdentifier || prescription?.patientIdentifier;
      console.log('Selected guestId (single result):', guestId);
    }
  }

  if (!guestId) {
    throw new Error('Session not found');
  }

  return guestId;
}

async function getSessionDetails({ orderId, userId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      checkoutSessionId: true,
      patientIdentifier: true,
      email: true,
    },
  });

  if (!order || order.patientIdentifier !== userId) {
    throw new Error('Order not found or unauthorized');
  }

  const sessionOrders = await prisma.order.findMany({
    where: {
      checkoutSessionId: order.checkoutSessionId,
      patientIdentifier: userId,
      status: 'pending',
    },
    select: {
      id: true,
      totalPrice: true,
      status: true,
    },
  });

  if (sessionOrders.length === 0) {
    throw new Error('No pending orders found in this session');
  }

  const totalAmount = sessionOrders.reduce((sum, o) => sum + o.totalPrice, 0);

  console.log('Session details retrieved:', { orderId, userId, checkoutSessionId: order.checkoutSessionId, totalAmount });

  return {
    message: 'Session details retrieved',
    checkoutSessionId: order.checkoutSessionId,
    totalAmount,
    email: order.email || null,
    orders: sessionOrders.map(o => ({
      orderId: o.id,
      totalPrice: o.totalPrice,
      status: o.status,
    })),
  };
}

async function resumeCheckout({ orderId, email, userId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
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

  if (!order || order.patientIdentifier !== userId) {
    throw new Error('Order not found or unauthorized');
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
    },
  });

  if (sessionOrders.length === 0) {
    throw new Error('No orders awaiting payment in this session');
  }

  const totalAmount = sessionOrders.reduce((sum, o) => sum + o.totalPrice, 0) * 100;
  if (totalAmount <= 0) {
    throw new Error('Invalid order amount');
  }

  const transactionReference = `session_${order.checkoutSessionId}_${Date.now()}`;
  const paymentReferences = [];

  // Paystack requires an email, so we'll use a placeholder if none provided
  const paystackEmail = email || `guest-${userId}@manzu.com`;
  
  const paystackResponse = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email: paystackEmail,
      amount: totalAmount,
      reference: transactionReference,
      callback_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/med-confirmation/callback?session=${order.checkoutSessionId}`,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!paystackResponse.data.status) {
    throw new Error('Failed to initialize payment: ' + JSON.stringify(paystackResponse.data));
  }

  console.log('Creating TransactionReference in resume checkout:', {
    transactionReference,
    orderReferences: paymentReferences,
    checkoutSessionId: order.checkoutSessionId
  });
  
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
    
    try {
      await tx.transactionReference.create({
        data: {
          transactionReference,
          orderReferences: paymentReferences,
          checkoutSessionId: order.checkoutSessionId,
          createdAt: new Date(),
        },
      });
      console.log('TransactionReference created successfully in resume checkout');
    } catch (error) {
      console.error('Error creating TransactionReference in resume checkout:', error);
      throw new Error('Failed to create transaction reference in resume checkout: ' + error.message);
    }
  });

  console.log('Checkout resumed for session:', { orderId, userId, checkoutSessionId: order.checkoutSessionId, totalAmount, transactionReference, paymentReferences });

  return {
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
  };
}

async function getResumeOrders({ orderId, userId }) {
  const initialOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { checkoutSessionId: true, patientIdentifier: true, status: true },
  });

  if (!initialOrder || initialOrder.patientIdentifier !== userId || initialOrder.status !== 'pending') {
    throw new Error('Order not found, unauthorized, or not pending');
  }

  const orders = await prisma.order.findMany({
    where: {
      checkoutSessionId: initialOrder.checkoutSessionId,
      patientIdentifier: userId,
      status: 'pending',
    },
    include: {
      items: {
        include: {
          pharmacyMedication: { include: { medication: true, pharmacy: true } },
        },
      },
      pharmacy: true,
    },
  });

  if (!orders.length) {
    throw new Error('No pending orders found for this session');
  }

  const pharmacies = orders.reduce((acc, order) => {
    const pharmacyId = order.pharmacyId;
    const existing = acc.find(p => p.pharmacy.id === pharmacyId);
    const orderData = {
      id: order.id,
      totalPrice: order.totalPrice,
      status: order.status,
      email: order.email || null,
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

  return {
    pharmacies,
    trackingCode: orders[0].trackingCode || 'Pending',
  };
}

module.exports = {
  initiateCheckout,
  retrieveSession,
  getSessionDetails,
  resumeCheckout,
  getResumeOrders,
};