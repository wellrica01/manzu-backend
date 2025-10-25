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
    status: { in: ['CART', 'PENDING'] } // uppercase enums
  },
  include: {
    OrderItem: {
      include: {
        MedicationAvailability: {
          include: {
            Medication: {
              include: {
                Medication_MedicationIngredient: {
                  select: {
                    MedicationIngredient: {
                      select: {
                        strengthValue: true,
                        strengthUnit: true,
                        ActiveSubstance: { select: { name: true } }
                      }
                    }
                  },
                  take: 1 // pick first ingredient for simplicity
                }
              }
            },
            Pharmacy: {
              include: {
                OperatingHour: true
              }
            }
          }
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
    for (const item of order.OrderItem) {
      const isOTC = !item.MedicationAvailability.Medication.prescriptionRequired;
      const isVerifiedPrescription = item.MedicationAvailability.Medication.prescriptionRequired && 
                                   order.status === 'PENDING' && 
                                   order.prescriptionId;
      
      if (isOTC || isVerifiedPrescription) {
        readyItems.push({
          ...item,
          orderId: order.id,
          orderStatus: order.status,
          prescriptionId: order.prescriptionId,
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
      acc[pharmacyId] = { items: [], pharmacy: item.MedicationAvailability.Pharmacy };
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
      if ((item.MedicationAvailability.stock || 0) < item.quantity) {
        throw new Error(`Insufficient stock for ${item.MedicationAvailability.Medication.brandName}`);
      }
      
      // Check if prescription medications have verified prescriptions
      if (item.MedicationAvailability.Medication.prescriptionRequired) {
        const verifiedPrescription = await prisma.prescription.findFirst({
          where: { 
            userIdentifier, 
            status: 'VERIFIED',
            PrescriptionMedication: {
              some: {
                medicationId: item.MedicationAvailability.medicationId
              }
            }
          },
        });
        
        if (!verifiedPrescription) {
          throw new Error(`Prescription required for ${item.MedicationAvailability.Medication.brandName} but not verified`);
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
    // Use UUID to prevent collisions in concurrent checkouts
    const paymentReference = `order_${uuidv4()}_${pharmacyId}`;
    
    const newOrder = await prisma.$transaction(async (tx) => {
      const prescriptionIdForGroup = items.find(
        i => i.MedicationAvailability.Medication.prescriptionRequired && i.orderStatus === 'PENDING'
      )?.prescriptionId || null;

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
          prescriptionId: prescriptionIdForGroup,

        },
      });

      for (const item of items) {
        await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            pharmacyId: item.pharmacyId,
            medicationId: item.MedicationAvailability.medicationId,
            quantity: item.quantity,
            price: item.price,
          },
        });

        // ✅ RACE CONDITION FIX: Check stock with row-level lock
        // Use raw SQL with SELECT FOR UPDATE to lock the row and prevent concurrent modifications
        const availability = await tx.$queryRaw`
          SELECT stock, "medicationId", "pharmacyId"
          FROM "MedicationAvailability"
          WHERE "medicationId" = ${item.MedicationAvailability.medicationId}
            AND "pharmacyId" = ${item.pharmacyId}
          FOR UPDATE
        `;

        if (!availability || availability.length === 0) {
          throw new Error(
            `Medication availability not found for ${item.MedicationAvailability.Medication.brandName}`
          );
        }

        const currentStock = availability[0].stock;

        // Verify sufficient stock AFTER acquiring lock
        if (currentStock < item.quantity) {
          throw new Error(
            `Insufficient stock for ${item.MedicationAvailability.Medication.brandName}. ` +
            `Only ${currentStock} available, but ${item.quantity} requested.`
          );
        }

        // Now safely decrement stock
        await tx.medicationAvailability.update({
          where: {
            medicationId_pharmacyId: {
              medicationId: item.MedicationAvailability.medicationId,
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
  
  const callbackUrl = `${process.env.BACKEND_URL || 'http://192.168.221.67:5000'}/api/med-confirmation/callback?session=${checkoutSessionId}`;
  
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