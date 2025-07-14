const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { recalculateOrderTotal } = require('../utils/cartUtils');
const prisma = new PrismaClient();

async function addToCart({ medicationId, pharmacyId, quantity, userId }) {
  // Generate userId if not provided
  userId = userId || uuidv4();

  // Check if pharmacy exists
  const pharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacyId } });
  if (!pharmacy) {
    throw new Error('Pharmacy not found');
  }

  // Check if medication requires prescription
  const medication = await prisma.medication.findUnique({ 
    where: { id: medicationId },
    select: { prescriptionRequired: true }
  });

  if (!medication) {
    throw new Error('Medication not found');
  }

  // Check if a cart order already exists for this user
  let cartOrder = await prisma.order.findFirst({
    where: {
      patientIdentifier: userId,
      status: 'cart',
    },
  });

  // Check if there's a pending_prescription order for this user
  const prescriptionOrder = await prisma.order.findFirst({
    where: {
      patientIdentifier: userId,
      status: 'pending_prescription',
    },
  });

  // --- NEW LOGIC: Check for verified prescription for this user/medication ---
  let verifiedPrescription = null;
  if (medication.prescriptionRequired) {
    verifiedPrescription = await prisma.prescription.findFirst({
      where: {
        patientIdentifier: userId,
        status: 'verified',
        PrescriptionMedication: {
          some: { medicationId: medicationId }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  // --- END NEW LOGIC ---

  // Determine which order to use based on medication type
  let targetOrder;
  if (medication.prescriptionRequired) {
    // If verified prescription exists, create order with status 'pending' and link prescriptionId
    if (verifiedPrescription) {
      // Check if a 'pending' order with this prescription already exists
      let pendingOrder = await prisma.order.findFirst({
        where: {
          patientIdentifier: userId,
          status: 'pending',
          prescriptionId: verifiedPrescription.id,
        },
      });
      if (!pendingOrder) {
        pendingOrder = await prisma.order.create({
          data: {
            patientIdentifier: userId,
            status: 'pending',
            totalPrice: 0,
            deliveryMethod: 'unspecified',
            paymentStatus: 'pending',
            prescriptionId: verifiedPrescription.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      targetOrder = pendingOrder;
    } else if (prescriptionOrder) {
      // Check if the existing prescription covers this medication
      const isCovered = await checkPrescriptionCoverage(prescriptionOrder.prescriptionId, medicationId);
      if (isCovered) {
        // Medication is covered by existing prescription - add to prescription order
        targetOrder = prescriptionOrder;
      } else {
        // Medication is not covered - add to cart order for new prescription upload
        if (!cartOrder) {
          cartOrder = await prisma.order.create({
            data: {
              patientIdentifier: userId,
              status: 'cart',
              totalPrice: 0,
              deliveryMethod: 'unspecified',
              paymentStatus: 'pending',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
        targetOrder = cartOrder;
      }
    } else if (cartOrder) {
      targetOrder = cartOrder;
    } else {
      // Create new cart order for prescription items
      targetOrder = await prisma.order.create({
        data: {
          patientIdentifier: userId,
          status: 'cart',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  } else {
    // OTC medication - always use cart order
    if (!cartOrder) {
      cartOrder = await prisma.order.create({
        data: {
          patientIdentifier: userId,
          status: 'cart',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    targetOrder = cartOrder;
  }

  // Use the target order for adding items
  const order = targetOrder;

  // Check if the medication is available at the selected pharmacy with sufficient stock
  const pharmacyMedication = await prisma.pharmacyMedication.findFirst({
    where: { medicationId, pharmacyId, stock: { gte: quantity } },
  });

  if (!pharmacyMedication) {
    throw new Error('Medication not available at this pharmacy or insufficient stock');
  }

  // Perform order item creation/update and total recalculation in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const orderItem = await tx.orderItem.upsert({
      where: {
        orderId_pharmacyMedicationPharmacyId_pharmacyMedicationMedicationId: {
          orderId: order.id,
          pharmacyMedicationPharmacyId: pharmacyId,
          pharmacyMedicationMedicationId: medicationId,
        },
      },
      update: {
        quantity: { increment: quantity },
        price: pharmacyMedication.price,
      },
      create: {
        orderId: order.id,
        pharmacyMedicationPharmacyId: pharmacyId,
        pharmacyMedicationMedicationId: medicationId,
        quantity,
        price: pharmacyMedication.price,
      },
    });

    const { updatedOrder } = await recalculateOrderTotal(tx, order.id);

    // Clean up empty orders (except the one we just added to)
    await cleanupEmptyOrders(tx, userId, order.id);

    return { orderItem, order: updatedOrder };
  });

  console.log('Created/Updated OrderItem:', result.orderItem);
  return { orderItem: result.orderItem, userId };
}

async function checkPrescriptionCoverage(prescriptionId, medicationId) {
  try {
    // Check if the prescription covers this specific medication
    const prescriptionMedication = await prisma.prescriptionMedication.findFirst({
      where: {
        prescriptionId: prescriptionId,
        medicationId: Number(medicationId),
      },
    });

    return !!prescriptionMedication;
  } catch (error) {
    console.error('Error checking prescription coverage:', error);
    return false;
  }
}

async function cleanupEmptyOrders(tx, userId, excludeOrderId) {
  // Find all orders for this user
  const orders = await tx.order.findMany({
    where: {
      patientIdentifier: userId,
      status: { in: ['cart', 'pending_prescription'] },
    },
    include: {
      items: true,
    },
  });

  // Delete empty orders (except the excluded one)
  for (const order of orders) {
    if (order.id !== excludeOrderId && order.items.length === 0) {
      await tx.order.delete({
        where: { id: order.id },
      });
      console.log('Cleaned up empty order:', order.id);
    }
  }
}

async function getCart(userId) {
  // Fetch orders that should be displayed in cart (cart status + pending_prescription + pending for verified prescriptions)
  const orders = await prisma.order.findMany({
    where: { 
      patientIdentifier: userId, 
      status: { in: ['cart', 'pending_prescription', 'pending'] }
    },
    include: {
      items: {
        include: {
          pharmacyMedication: {
            include: {
              pharmacy: true,
              medication: true,
            },
          },
        },
      },
      prescription: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!orders || orders.length === 0) {
    return { items: [], totalPrice: 0, pharmacies: [], orderStatus: null };
  }

  // Merge all orders into a single cart view with order information
  const allItems = [];
  let totalPrice = 0;
  let prescriptionId = null;
  let orderStatus = null;

  for (const order of orders) {
    // Get prescription status if order has a prescription
    let prescriptionStatus = null;
    if (order.prescriptionId) {
      const prescription = await prisma.prescription.findUnique({
        where: { id: order.prescriptionId },
        select: { status: true }
      });
      prescriptionStatus = prescription?.status || null;
    }

    // Add order information to each item
    const itemsWithOrderInfo = order.items.map(item => ({
      ...item,
      orderInfo: {
        orderId: order.id,
        orderStatus: order.status,
        prescriptionId: order.prescriptionId,
        prescriptionStatus: prescriptionStatus,
      }
    }));
    
    allItems.push(...itemsWithOrderInfo);
    totalPrice += order.totalPrice;
    if (order.prescriptionId) {
      prescriptionId = order.prescriptionId;
    }
    // Track the most relevant status for display
    if (order.status === 'pending_prescription') {
      orderStatus = 'pending_prescription';
    } else if (order.status === 'pending' && orderStatus !== 'pending_prescription') {
      orderStatus = 'pending';
    } else if (order.status === 'cart' && orderStatus !== 'pending_prescription' && orderStatus !== 'pending') {
      orderStatus = 'cart';
    }
  }

  const pharmacyGroups = allItems.reduce((acc, item) => {
    const pharmacyId = item.pharmacyMedication?.pharmacy?.id;
    if (!pharmacyId) return acc; // Skip if data is incomplete

    if (!acc[pharmacyId]) {
      acc[pharmacyId] = {
        pharmacy: {
          id: pharmacyId,
          name: item.pharmacyMedication?.pharmacy?.name ?? "Unknown Pharmacy",
          address: item.pharmacyMedication?.pharmacy?.address ?? "No address",
          phone: item.pharmacyMedication?.pharmacy?.phone ?? null,
          licenseNumber: item.pharmacyMedication?.pharmacy?.licenseNumber ?? null,
          ward: item.pharmacyMedication?.pharmacy?.ward ?? null,
          lga: item.pharmacyMedication?.pharmacy?.lga ?? null,
          state: item.pharmacyMedication?.pharmacy?.state ?? null,
          operatingHours: item.pharmacyMedication?.pharmacy?.operatingHours ?? null,
          status: item.pharmacyMedication?.pharmacy?.status ?? 'pending',
          logoUrl: item.pharmacyMedication?.pharmacy?.logoUrl ?? null,
        },
        items: [],
        subtotal: 0,
      };
    }

    acc[pharmacyId].items.push({
      id: item.id,
      medication: {
        name: item.pharmacyMedication?.medication?.name ?? "Unknown",
        genericName: item.pharmacyMedication?.medication?.genericName ?? null,
        displayName: `${item.pharmacyMedication?.medication?.name ?? ""}${item.pharmacyMedication?.medication?.dosage ? ` ${item.pharmacyMedication.medication.dosage}` : ''}${item.pharmacyMedication?.medication?.form ? ` (${item.pharmacyMedication.medication.form})` : ''}`,
        category: item.pharmacyMedication?.medication?.category ?? null,
        description: item.pharmacyMedication?.medication?.description ?? null,
        manufacturer: item.pharmacyMedication?.medication?.manufacturer ?? null,
        form: item.pharmacyMedication?.medication?.form ?? null,
        dosage: item.pharmacyMedication?.medication?.dosage ?? null,
        imageUrl: item.pharmacyMedication?.medication?.imageUrl ?? null,
        prescriptionRequired: item.pharmacyMedication?.medication?.prescriptionRequired ?? false,
      },
      quantity: item.quantity,
      price: item.price,
      pharmacyMedicationMedicationId: item.pharmacyMedicationMedicationId,
      pharmacyMedicationPharmacyId: item.pharmacyMedicationPharmacyId,
      // Add prescription status based on order status and prescription status
      prescriptionStatus: item.orderInfo.prescriptionId && item.pharmacyMedication?.medication?.prescriptionRequired 
        ? (item.orderInfo.orderStatus === 'pending' ? 'verified' : 
           item.orderInfo.orderStatus === 'pending_prescription' ? 
             (item.orderInfo.prescriptionStatus === 'rejected' ? 'rejected' : 'pending') : 'none')
        : 'none',
    });

    acc[pharmacyId].subtotal += item.quantity * item.price;
    return acc;
  }, {});

  const pharmacies = Object.values(pharmacyGroups);
  const calculatedTotalPrice = pharmacies.reduce((sum, p) => sum + p.subtotal, 0);

  console.log('GET /api/cart response:', { pharmacies, totalPrice: calculatedTotalPrice, orderStatus });

  return {
    pharmacies,
    totalPrice: calculatedTotalPrice,
    prescriptionId: prescriptionId,
    orderStatus: orderStatus,
    orderId: orders[0]?.id, // Return the first order ID for compatibility
  };
}

async function createMixedOrder({ userId, readyItems, prescriptionItems }) {
  // Create separate orders for ready items and prescription items
  const result = await prisma.$transaction(async (tx) => {
    // Create order for ready items (immediate checkout)
    const readyOrder = await tx.order.create({
      data: {
        patientIdentifier: userId,
        status: 'pending',
        totalPrice: 0,
        deliveryMethod: 'unspecified',
        paymentStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Create order for prescription items (pending verification)
    const prescriptionOrder = await tx.order.create({
      data: {
        patientIdentifier: userId,
        status: 'pending_prescription',
        totalPrice: 0,
        deliveryMethod: 'unspecified',
        paymentStatus: 'pending',
        prescriptionId: prescriptionItems.prescriptionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Move ready items to ready order
    for (const item of readyItems) {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { orderId: readyOrder.id },
      });
    }

    // Move prescription items to prescription order
    for (const item of prescriptionItems.items) {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { orderId: prescriptionOrder.id },
      });
    }

    // Recalculate totals for both orders
    const { updatedOrder: updatedReadyOrder } = await recalculateOrderTotal(tx, readyOrder.id);
    const { updatedOrder: updatedPrescriptionOrder } = await recalculateOrderTotal(tx, prescriptionOrder.id);

    return {
      readyOrder: updatedReadyOrder,
      prescriptionOrder: updatedPrescriptionOrder,
    };
  });

  return result;
}

async function handlePrescriptionVerification({ prescriptionId, status }) {
  // When prescription is verified, update the associated order status
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      orders: {
        where: { status: 'pending_prescription' },
        include: {
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
    throw new Error('Prescription not found');
  }

  if (status === 'verified') {
    // Update prescription order to ready for checkout
    for (const order of prescription.orders) {
      await prisma.order.update({
        where: { id: order.id },
        data: { 
          status: 'pending',
          updatedAt: new Date(),
        },
      });
    }
  } else if (status === 'rejected') {
    // Keep prescription order as pending_prescription for re-upload
    // User can upload new prescription
  }

  return prescription;
}

async function updateCartItem({ orderItemId, quantity, userId }) {
  // Find the order that contains this item
  const orderItem = await prisma.orderItem.findFirst({
    where: { id: orderItemId },
    include: { 
      order: true,
      pharmacyMedication: true 
    },
  });
  
  if (!orderItem) {
    throw new Error('Item not found');
  }

  const order = orderItem.order;
  
  // Check if the order belongs to this user and has appropriate status
  if (order.patientIdentifier !== userId || !['cart', 'pending_prescription', 'pending'].includes(order.status)) {
    throw new Error('Cart not found');
  }

  const pharmacyMedication = await prisma.pharmacyMedication.findFirst({
    where: {
      medicationId: orderItem.pharmacyMedicationMedicationId,
      pharmacyId: orderItem.pharmacyMedicationPharmacyId,
      stock: { gte: quantity },
    },
  });
  if (!pharmacyMedication) {
    throw new Error('Insufficient stock');
  }

  // Perform order item update and total recalculation in a transaction
  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { quantity, price: pharmacyMedication.price },
    });

    await recalculateOrderTotal(tx, order.id);

    // Clean up empty orders
    await cleanupEmptyOrders(tx, userId, order.id);

    return item;
  });

  return updatedItem;
}

async function removeFromCart({ orderItemId, userId }) {
  // Find the order that contains this item
  const orderItem = await prisma.orderItem.findFirst({
    where: { id: orderItemId },
    include: { order: true },
  });
  
  if (!orderItem) {
    throw new Error('Item not found');
  }

  const order = orderItem.order;
  
  // Check if the order belongs to this user and has appropriate status
  if (order.patientIdentifier !== userId || !['cart', 'pending_prescription'].includes(order.status)) {
    throw new Error('Cart not found');
  }

  // Perform order item deletion, total recalculation, and cleanup in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.delete({
      where: { id: orderItemId, orderId: order.id },
    });

    await recalculateOrderTotal(tx, order.id);

    // Check if order is now empty and delete it if so
    const remainingItems = await tx.orderItem.count({
      where: { orderId: order.id },
    });

    if (remainingItems === 0) {
      await tx.order.delete({
        where: { id: order.id },
      });
      console.log('Deleted empty order:', order.id);
    }
  });
}

async function linkPrescriptionToCart({ prescriptionId, userId }) {
  const order = await prisma.order.findFirst({
    where: { 
      patientIdentifier: userId, 
      status: { in: ['cart', 'pending_prescription'] }
    },
  });
  
  if (!order) {
    throw new Error('Cart not found');
  }

  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
  });

  if (!prescription) {
    throw new Error('Prescription not found');
  }

  // Get all items in the cart
  const orderItems = await prisma.orderItem.findMany({
    where: { orderId: order.id },
    include: {
      pharmacyMedication: {
        include: { medication: true },
      },
    },
  });

  const otcItems = orderItems.filter(item => !item.pharmacyMedication.medication.prescriptionRequired);
  const prescriptionItems = orderItems.filter(item => item.pharmacyMedication.medication.prescriptionRequired);

  // If we have both OTC and prescription items, create separate orders
  if (otcItems.length > 0 && prescriptionItems.length > 0) {
    return await prisma.$transaction(async (tx) => {
      // Create new order for OTC items (keep as cart) - no contact info needed
      const otcOrder = await tx.order.create({
        data: {
          patientIdentifier: userId,
          status: 'cart',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create new order for prescription items - with contact info
      const prescriptionOrder = await tx.order.create({
        data: {
          patientIdentifier: userId,
          status: 'pending_prescription',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          prescriptionId: prescriptionId,
          email: prescription.email || order.email,
          phone: prescription.phone || order.phone,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Move OTC items to OTC order
      for (const item of otcItems) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { orderId: otcOrder.id },
        });
      }

      // Move prescription items to prescription order
      for (const item of prescriptionItems) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { orderId: prescriptionOrder.id },
        });
      }

      // Recalculate totals for both orders
      const { updatedOrder: updatedOtcOrder } = await recalculateOrderTotal(tx, otcOrder.id);
      const { updatedOrder: updatedPrescriptionOrder } = await recalculateOrderTotal(tx, prescriptionOrder.id);

      // Delete the original mixed order
      await tx.order.delete({
        where: { id: order.id },
      });

      return {
        otcOrder: updatedOtcOrder,
        prescriptionOrder: updatedPrescriptionOrder,
      };
    });
  } else {
    // Single type cart - just link prescription to existing order
    const updateData = { 
      prescriptionId: prescriptionId,
    };

    if (prescriptionItems.length > 0) {
      updateData.status = 'pending_prescription';
      updateData.updatedAt = new Date();
      // Only add contact info for prescription orders
      updateData.email = prescription.email || order.email;
      updateData.phone = prescription.phone || order.phone;
    }

    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: updateData,
    });

    return updatedOrder;
  }
}

async function getPrescriptionStatusesForCart({ userId, medicationIds }) {
  try {
    // Get all cart orders (including pending_prescription status)
    const orders = await prisma.order.findMany({
      where: { 
        patientIdentifier: userId, 
        status: { in: ['cart', 'pending_prescription'] }
      },
      include: {
        prescription: {
          include: {
            PrescriptionMedication: {
              include: {
                Medication: {
                  select: { id: true },
                },
              },
            },
          },
        },
        items: {
          include: {
            pharmacyMedication: {
              include: { medication: true },
            },
          },
        },
      },
    });

    if (!orders || orders.length === 0) {
      // No orders found, return all as 'none'
      return Object.fromEntries(medicationIds.map(id => [id, 'none']));
    }

    const statuses = Object.fromEntries(medicationIds.map(id => [id, 'none']));

    // Check each order for prescription coverage
    for (const order of orders) {
      if (order.prescription) {
        const prescription = order.prescription;
        
        // Get medication IDs in this order
        const orderMedicationIds = order.items.map(item => 
          item.pharmacyMedication.medication.id.toString()
        );

        // Map medicationIds covered by the prescription
        const coveredMedicationIds = prescription.PrescriptionMedication
          .map(pm => pm.medicationId.toString());

        // Update statuses for medications in this order that are covered by prescription
        for (const medId of medicationIds) {
          if (orderMedicationIds.includes(medId) && coveredMedicationIds.includes(medId)) {
            statuses[medId] = prescription.status; // 'verified' or 'pending'
          }
        }
      }
    }

    return statuses;
  } catch (error) {
    console.error('Error fetching prescription statuses for cart:', error);
    throw new Error('Failed to fetch prescription statuses');
  }
}

async function linkPrescriptionToSpecificOrder({ prescriptionId, userId, medicationIds }) {
  // Find orders that contain the specified medications (both cart and pending_prescription status)
  const orders = await prisma.order.findMany({
    where: {
      patientIdentifier: userId,
      status: { in: ['cart', 'pending_prescription'] },
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

  if (!orders || orders.length === 0) {
    throw new Error('Cart not found');
  }

  // Find the order that contains the specified medications
  let targetOrder = null;
  let orderMedicationIds = [];

  for (const order of orders) {
    const orderMeds = order.items.map(item => 
    item.pharmacyMedication.medication.id.toString()
  );

  const hasSpecifiedMedications = medicationIds.some(medId => 
      orderMeds.includes(medId)
  );

    if (hasSpecifiedMedications) {
      targetOrder = order;
      orderMedicationIds = orderMeds;
      break;
    }
  }

  if (!targetOrder) {
    throw new Error('Specified medications not found in cart');
  }

  if (medicationIds.length === 0) {
    throw new Error('No medication IDs provided');
  }

  // Get prescription contact info
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
  });

  if (!prescription) {
    throw new Error('Prescription not found');
  }

  // Separate OTC and prescription items
  const otcItems = targetOrder.items.filter(item => 
    !item.pharmacyMedication.medication.prescriptionRequired
  );
  
  const prescriptionItems = targetOrder.items.filter(item => 
    item.pharmacyMedication.medication.prescriptionRequired
  );

  // Check if the specified medications are prescription items
  const specifiedPrescriptionItems = prescriptionItems.filter(item => 
    medicationIds.includes(item.pharmacyMedication.medication.id.toString())
  );

  if (specifiedPrescriptionItems.length === 0) {
    throw new Error('Specified medications are not prescription items');
  }

  // Use transaction to handle order updates
  const result = await prisma.$transaction(async (tx) => {
    // If this is a rejected prescription case (order already has prescriptionId), 
    // just update the existing order with the new prescriptionId
    if (targetOrder.prescriptionId && targetOrder.status === 'pending_prescription') {
      const updatedOrder = await tx.order.update({
        where: { id: targetOrder.id },
        data: {
          prescriptionId: prescriptionId,
          email: prescription.email,
          phone: prescription.phone,
          updatedAt: new Date(),
        },
      });

      console.log('Updated existing prescription order with new prescription:', {
        orderId: updatedOrder.id,
        oldPrescriptionId: targetOrder.prescriptionId,
        newPrescriptionId: prescriptionId,
        medicationIds: medicationIds,
        email: prescription.email,
        phone: prescription.phone
      });

      return updatedOrder;
    }

    // If we have both OTC and prescription items, create separate orders
    if (otcItems.length > 0 && prescriptionItems.length > 0) {
      // Create new order for OTC items (keep as cart)
      const otcOrder = await tx.order.create({
        data: {
          patientIdentifier: userId,
          status: 'cart',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create new order for prescription items (pending verification)
      const prescriptionOrder = await tx.order.create({
        data: {
          patientIdentifier: userId,
          status: 'pending_prescription',
          totalPrice: 0,
          deliveryMethod: 'unspecified',
          paymentStatus: 'pending',
          prescriptionId: prescriptionId,
          email: prescription.email,
          phone: prescription.phone,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Move OTC items to OTC order
      for (const item of otcItems) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { orderId: otcOrder.id },
        });
      }

      // Move prescription items to prescription order
      for (const item of prescriptionItems) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { orderId: prescriptionOrder.id },
        });
      }

      // Recalculate totals for both orders
      const { updatedOrder: updatedOtcOrder } = await recalculateOrderTotal(tx, otcOrder.id);
      const { updatedOrder: updatedPrescriptionOrder } = await recalculateOrderTotal(tx, prescriptionOrder.id);

      // Delete the original mixed order
      await tx.order.delete({
        where: { id: targetOrder.id },
      });

      console.log('Separated orders after prescription upload:', {
        otcOrderId: updatedOtcOrder.id,
        prescriptionOrderId: updatedPrescriptionOrder.id,
        prescriptionId: prescriptionId,
        medicationIds: medicationIds,
        email: prescription.email,
        phone: prescription.phone
      });

      return {
        otcOrder: updatedOtcOrder,
        prescriptionOrder: updatedPrescriptionOrder,
      };
    } else if (prescriptionItems.length > 0) {
      // Only prescription items - update existing order
      const updatedOrder = await tx.order.update({
        where: { id: targetOrder.id },
        data: {
          prescriptionId: prescriptionId,
          status: 'pending_prescription',
          email: prescription.email,
          phone: prescription.phone,
          updatedAt: new Date(),
        },
      });

      console.log('Updated prescription order:', {
        orderId: updatedOrder.id,
        prescriptionId: prescriptionId,
        medicationIds: medicationIds,
        email: prescription.email,
        phone: prescription.phone
      });

      return updatedOrder;
    } else {
      // Only OTC items - this shouldn't happen but handle gracefully
      throw new Error('No prescription items found in cart');
    }
  });

  return result;
}

module.exports = {
  addToCart,
  getCart,
  updateCartItem,
  removeFromCart,
  linkPrescriptionToCart,
  linkPrescriptionToSpecificOrder,
  getPrescriptionStatusesForCart,
  createMixedOrder,
  handlePrescriptionVerification,
  cleanupEmptyOrders,
  checkPrescriptionCoverage,
};