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
      userIdentifier: userId,
      status: 'CART',
    },
  });

  // Check if there's a pending_prescription order for this user
  const prescriptionOrder = await prisma.order.findFirst({
    where: {
      userIdentifier: userId,
      status: 'PENDING_PRESCRIPTION',
    },
  });

  // --- NEW LOGIC: Check for verified prescription for this user/medication ---
  let verifiedPrescription = null;
  if (medication.prescriptionRequired) {
    verifiedPrescription = await prisma.prescription.findFirst({
      where: {
        userIdentifier: userId,
        status: 'VERIFIED',
        prescriptionMedications: {
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
          userIdentifier: userId,
          status: 'PENDING',
          prescriptionId: verifiedPrescription.id,
        },
      });
      if (!pendingOrder) {
        pendingOrder = await prisma.order.create({
          data: {
            userIdentifier: userId,
            status: 'PENDING',
            totalPrice: 0,
            deliveryMethod: 'UNSPECIFIED',
            paymentStatus: 'PENDING',
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
              userIdentifier: userId,
              status: 'CART',
              totalPrice: 0,
              deliveryMethod: 'UNSPECIFIED',
              paymentStatus: 'PENDING',
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
          userIdentifier: userId,
          status: 'CART',
          totalPrice: 0,
          deliveryMethod: 'UNSPECIFIED',
          paymentStatus: 'PENDING',
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
          userIdentifier: userId,
          status: 'CART',
          totalPrice: 0,
          deliveryMethod: 'UNSPECIFIED',
          paymentStatus: 'PENDING',
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
  const pharmacyMedication = await prisma.medicationAvailability.findFirst({
    where: { medicationId, pharmacyId, stock: { gte: quantity } },
  });

  if (!pharmacyMedication) {
    throw new Error('Medication not available at this pharmacy or insufficient stock');
  }

  // Perform order item creation/update and total recalculation in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const orderItem = await tx.orderItem.upsert({
      where: {
        orderId_pharmacyId_medicationId: {
          orderId: order.id,
          pharmacyId: pharmacyId,
          medicationId: medicationId,
        },
      },
      update: {
        quantity: { increment: quantity },
        price: pharmacyMedication.price,
      },
      create: {
        orderId: order.id,
        pharmacyId: pharmacyId,
        medicationId: medicationId,
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
      userIdentifier: userId,
      status: { in: ['CART', 'PENDING_PRESCRIPTION'] },
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
      userIdentifier: userId, 
      status: { in: ['CART', 'PENDING_PRESCRIPTION', 'PENDING'] }
    },
    include: {
      items: {
        include: {
          medicationAvailability: {
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
    if (order.status === 'PENDING_PRESCRIPTION') {
      orderStatus = 'PENDING_PRESCRIPTION';
    } else if (order.status === 'PENDING' && orderStatus !== 'PENDING_PRESCRIPTION') {
      orderStatus = 'PENDING';
    } else if (order.status === 'CART' && orderStatus !== 'PENDING_PRESCRIPTION' && orderStatus !== 'PENDING') {
      orderStatus = 'CART';
    }
  }

  const pharmacyGroups = allItems.reduce((acc, item) => {
    const pharmacyId = item.medicationAvailability?.pharmacy?.id;
    if (!pharmacyId) return acc; // Skip if data is incomplete

    if (!acc[pharmacyId]) {
      acc[pharmacyId] = {
        pharmacy: {
          id: pharmacyId,
          name: item.medicationAvailability?.pharmacy?.name ?? "Unknown Pharmacy",
          address: item.medicationAvailability?.pharmacy?.address ?? "No address",
          phone: item.medicationAvailability?.pharmacy?.phone ?? null,
          licenseNumber: item.medicationAvailability?.pharmacy?.licenseNumber ?? null,
          ward: item.medicationAvailability?.pharmacy?.ward ?? null,
          lga: item.medicationAvailability?.pharmacy?.lga ?? null,
          state: item.medicationAvailability?.pharmacy?.state ?? null,
          operatingHours: item.medicationAvailability?.pharmacy?.operatingHours ?? null,
          status: item.medicationAvailability?.pharmacy?.status ?? 'pending',
          logoUrl: item.medicationAvailability?.pharmacy?.logoUrl ?? null,
        },
        items: [],
        subtotal: 0,
      };
    }

    acc[pharmacyId].items.push({
      id: item.id,
      medication: {
        id: item.medicationAvailability?.medication?.id,
        name: item.medicationAvailability?.medication?.name ?? "Unknown",
        genericName: item.medicationAvailability?.medication?.genericName ?? null,
        displayName: `${item.medicationAvailability?.medication?.name ?? ""}${item.medicationAvailability?.medication?.dosage ? ` ${item.medicationAvailability.medication.dosage}` : ''}${item.medicationAvailability?.medication?.form ? ` (${item.medicationAvailability.medication.form})` : ''}`,
        category: item.medicationAvailability?.medication?.category ?? null,
        description: item.medicationAvailability?.medication?.description ?? null,
        manufacturer: item.medicationAvailability?.medication?.manufacturer ?? null,
        form: item.medicationAvailability?.medication?.form ?? null,
        dosage: item.medicationAvailability?.medication?.dosage ?? null,
        imageUrl: item.medicationAvailability?.medication?.imageUrl ?? null,
        prescriptionRequired: item.medicationAvailability?.medication?.prescriptionRequired ?? false,
      },
      quantity: item.quantity,
      price: item.price,
      medicationAvailabilityMedicationId: item.medicationAvailabilityMedicationId,
      medicationAvailabilityPharmacyId: item.medicationAvailabilityPharmacyId,
      // Add prescription status based on order status and prescription status
      prescriptionStatus: item.orderInfo.prescriptionId && item.medicationAvailability?.medication?.prescriptionRequired 
        ? (item.orderInfo.orderStatus === 'PENDING' ? 'VERIFIED' : 
           item.orderInfo.orderStatus === 'PENDING_PRESCRIPTION' ? 
             (item.orderInfo.prescriptionStatus === 'REJECTED' ? 'REJECTED' : 'PENDING') : 'NONE')
        : 'NONE',
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
        userIdentifier: userId,
        status: 'PENDING',
        totalPrice: 0,
        deliveryMethod: 'UNSPECIFIED',
        paymentStatus: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Create order for prescription items (pending verification)
    const prescriptionOrder = await tx.order.create({
      data: {
        userIdentifier: userId,
        status: 'PENDING_PRESCRIPTION',
        totalPrice: 0,
        deliveryMethod: 'UNSPECIFIED',
        paymentStatus: 'PENDING',
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
        where: { status: 'PENDING_PRESCRIPTION' },
        include: {
          items: {
            include: {
              medicationAvailability: {
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

  if (status === 'VERIFIED') {
    // Update prescription order to ready for checkout
    for (const order of prescription.orders) {
      await prisma.order.update({
        where: { id: order.id },
        data: { 
          status: 'PENDING',
          updatedAt: new Date(),
        },
      });
    }
  } else if (status === 'REJECTED') {
    // Keep prescription order as PENDING_PRESCRIPTION for re-upload
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
      medicationAvailability: true 
    },
  });
  
  if (!orderItem) {
    throw new Error('Item not found');
  }

  const order = orderItem.order;
  
  // Check if the order belongs to this user and has appropriate status
  if (order.userIdentifier !== userId || !['CART', 'PENDING_PRESCRIPTION', 'PENDING'].includes(order.status)) {
    throw new Error('Cart not found');
  }

  const medicationAvailability = await prisma.medicationAvailability.findFirst({
    where: {
      medicationId: orderItem.medicationAvailabilityMedicationId,
      pharmacyId: orderItem.medicationAvailabilityPharmacyId,
      stock: { gte: quantity },
    },
  });
  if (!medicationAvailability) {
    throw new Error('Insufficient stock');
  }

  // Perform order item update and total recalculation in a transaction
  const updatedItem = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { quantity, price: medicationAvailability.price },
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
  if (order.userIdentifier !== userId || !['CART', 'PENDING_PRESCRIPTION'].includes(order.status)) {
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
      userIdentifier: userId, 
      status: { in: ['CART', 'PENDING_PRESCRIPTION'] }
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
      medicationAvailability: {
        include: { medication: true },
      },
    },
  });

  const otcItems = orderItems.filter(item => !item.medicationAvailability.medication.prescriptionRequired);
  const prescriptionItems = orderItems.filter(item => item.medicationAvailability.medication.prescriptionRequired);

  // If we have both OTC and prescription items, create separate orders
  if (otcItems.length > 0 && prescriptionItems.length > 0) {
    return await prisma.$transaction(async (tx) => {
      // Create new order for OTC items (keep as cart) - no contact info needed
      const otcOrder = await tx.order.create({
        data: {
          userIdentifier: userId,
          status: 'CART',
          totalPrice: 0,
          deliveryMethod: 'UNSPECIFIED',
          paymentStatus: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create new order for prescription items - with contact info
      const prescriptionOrder = await tx.order.create({
        data: {
          userIdentifier: userId,
          status: 'PENDING_PRESCRIPTION',
          totalPrice: 0,
          deliveryMethod: 'UNSPECIFIED',
          paymentStatus: 'PENDING',
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
      updateData.status = 'PENDING_PRESCRIPTION';
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
        userIdentifier: userId, 
        status: { in: ['CART', 'PENDING_PRESCRIPTION'] }
      },
      include: {
        prescription: {
          include: {
            prescriptionMedications: {
              include: {
                medication: {
                  select: { id: true },
                },
              },
            },
          },
        },
        items: {
          include: {
            medicationAvailability: {
              include: { medication: true },
            },
          },
        },
      },
    });

    if (!orders || orders.length === 0) {
      // No orders found, return all as 'none'
      return Object.fromEntries(medicationIds.map(id => [id, 'NONE']));
    }

    const statuses = Object.fromEntries(medicationIds.map(id => [id, 'NONE']));

    // Check each order for prescription coverage
    for (const order of orders) {
      if (order.prescription) {
        const prescription = order.prescription;
        
        // Get medication IDs in this order
        const orderMedicationIds = order.items.map(item => 
          item.medicationAvailability.medication.id.toString()
        );

        // Map medicationIds covered by the prescription
        const coveredMedicationIds = prescription.prescriptionMedications
          .map(pm => pm.medication.id.toString());

        // Update statuses for medications in this order that are covered by prescription
        for (const medId of medicationIds) {
          if (orderMedicationIds.includes(medId) && coveredMedicationIds.includes(medId)) {
            statuses[medId] = prescription.status; // 'VERIFIED' or 'PENDING'
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
      userIdentifier: userId,
      status: { in: ['CART', 'PENDING_PRESCRIPTION'] },
    },
    include: {
      items: {
        include: {
          medicationAvailability: {
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
    item.medicationAvailability.medication.id.toString()
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
    !item.medicationAvailability.medication.prescriptionRequired
  );
  
  const prescriptionItems = targetOrder.items.filter(item => 
    item.medicationAvailability.medication.prescriptionRequired
  );

  // Check if the specified medications are prescription items
  const specifiedPrescriptionItems = prescriptionItems.filter(item => 
    medicationIds.includes(item.medicationAvailability.medication.id.toString())
  );

  if (specifiedPrescriptionItems.length === 0) {
    throw new Error('Specified medications are not prescription items');
  }

  // Use transaction to handle order updates
  const result = await prisma.$transaction(async (tx) => {
    // If this is a rejected prescription case (order already has prescriptionId), 
    // just update the existing order with the new prescriptionId
    if (targetOrder.prescriptionId && targetOrder.status === 'PENDING_PRESCRIPTION') {
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
          userIdentifier: userId,
          status: 'CART',
          totalPrice: 0,
          deliveryMethod: 'UNSPECIFIED',
          paymentStatus: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create new order for prescription items (pending verification)
      const prescriptionOrder = await tx.order.create({
        data: {
          userIdentifier: userId,
          status: 'PENDING_PRESCRIPTION',
          totalPrice: 0,
          deliveryMethod: 'UNSPECIFIED',
          paymentStatus: 'PENDING',
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
          status: 'PENDING_PRESCRIPTION',
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