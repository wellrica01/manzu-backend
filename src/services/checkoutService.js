const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('../utils/validation');
const prisma = new PrismaClient();




async function initiateCheckout({ name, email, phone, address, deliveryMethod, userId }) {
  const userIdentifier = userId;
  const normalizedPhone = normalizePhone(phone);

  // Find all orders that contain ready medications (CART status + PENDING status for verified prescriptions)
  const cartOrders = await prisma.order.findMany({
    where: { 
      userIdentifier, 
      status: { in: ['CART', 'PENDING'] } // Use uppercase enums
    },
    include: {
      items: {
        include: {
          medicationAvailability: {
            include: { medication: { include: { genericMedication: true } }, pharmacy: true },
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
      const isOTC = !item.medicationAvailability.medication.prescriptionRequired;
      const isVerifiedPrescription = item.medicationAvailability.medication.prescriptionRequired && 
                                   order.status === 'PENDING' && 
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
    const pharmacyId = item.pharmacyId;
    if (!acc[pharmacyId]) {
      acc[pharmacyId] = { items: [], pharmacy: item.medicationAvailability.pharmacy };
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
      if ((item.medicationAvailability.stock || 0) < item.quantity) {
        throw new Error(`Insufficient stock for ${item.medicationAvailability.medication.brandName}`);
      }
      
      // Check if prescription medications have verified prescriptions
      if (item.medicationAvailability.medication.prescriptionRequired) {
        const verifiedPrescription = await prisma.prescription.findFirst({
          where: { 
            userIdentifier, 
            status: 'VERIFIED',
            prescriptionMedications: {
              some: {
                medicationId: item.medicationAvailability.medicationId
              }
            }
          },
        });
        
        if (!verifiedPrescription) {
          throw new Error(`Prescription required for ${item.medicationAvailability.medication.brandName} but not verified`);
        }
      }
    }
  }

  const orders = [];
  const paymentReferences = [];

  for (const pharmacyId of pharmacyIds) {
    const { items, pharmacy } = itemsByPharmacy[pharmacyId];
    const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderStatus = 'PENDING';
    const paymentReference = `order_${Date.now()}_${pharmacyId}`;
    
    const newOrder = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          userIdentifier,
          pharmacyId: parseInt(pharmacyId),
          status: orderStatus,
          deliveryMethod,
          address: deliveryMethod === 'COURIER' ? address : null,
          name,
          email,
          phone: normalizedPhone,
          totalPrice,
          paymentReference,
          paymentStatus: 'PENDING',
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
            pharmacyId: item.pharmacyId,
            medicationId: item.medicationAvailability.medicationId,
            quantity: item.quantity,
            price: item.price,
          },
        });

        await tx.medicationAvailability.update({
          where: {
            medicationId_pharmacyId: {
              medicationId: item.medicationAvailability.medicationId,
              pharmacyId: item.pharmacyId,
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

  // Paystack requires an email, so we'll use a placeholder if none provided
  const paystackEmail = email || `guest-${userIdentifier}@manzu.com`;
  
  const callbackUrl = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/med-confirmation/callback?session=${checkoutSessionId}`;
  
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

  try {
    await prisma.transactionReference.create({
      data: {
        transactionReference,
        orderReferences: paymentReferences,
        checkoutSessionId,
        createdAt: new Date(),
      },
    });
  } catch (error) {
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



module.exports = {
  initiateCheckout
};