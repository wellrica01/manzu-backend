/**
 * PHARMACY ORDERS SERVICE
 * 
 * Business logic for pharmacy order operations
 */

const repository = require('./pharmacy-orders.repository');
const prisma = require('../../../core/database/prisma');
const { HTTP_STATUS } = require('../../../config/constants');

/**
 * Fetch orders for a pharmacy with filters and pagination
 */
async function fetchOrders(pharmacyId, { page = 1, limit = 20, search = '', status = '', date = '', deliveryMethod = '' } = {}) {
  const skip = (page - 1) * limit;

  const baseWhere = {
    OrderItem: { some: { pharmacyId } },
    status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED'] },
  };

  // Add search filter
  if (search) {
    baseWhere.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { trackingCode: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Add status filter
  if (status) {
    baseWhere.status = status;
  }

  // Add date filter
  if (date) {
    const startOfDay = new Date(date + 'T00:00:00.000Z');
    const endOfDay = new Date(date + 'T23:59:59.999Z');
    baseWhere.createdAt = { gte: startOfDay, lte: endOfDay };
  }

  // Add delivery method filter
  if (deliveryMethod) {
    baseWhere.deliveryMethod = deliveryMethod;
  }

  // Fetch orders and total
  const { orders, total } = await repository.findOrders(pharmacyId, { skip, limit, where: baseWhere });

  // Get all order IDs for S/N mapping
  const allPharmacyOrderIds = await repository.getAllOrderIds(pharmacyId);
  const orderPositionMap = new Map(
    allPharmacyOrderIds.map((o, index) => [o.id, index + 1])
  );

  // Format orders with enhanced medication info
  const formattedOrders = orders.map(order => ({
    id: order.id,
    sn: orderPositionMap.get(order.id),
    name: order.name,
    phone: order.phone,
    email: order.email,
    createdAt: order.createdAt,
    trackingCode: order.trackingCode,
    userIdentifier: order.userIdentifier,
    deliveryMethod: order.deliveryMethod,
    address: order.address,
    status: order.status,
    totalPrice: order.totalPrice,
    pharmacyAmount: order.pharmacyAmount,
    prescription: order.Prescription
      ? { id: order.Prescription.id, fileUrl: order.Prescription.fileUrl, status: order.Prescription.status }
      : null,
    items: order.OrderItem
      .filter(item => item.pharmacyId === pharmacyId)
      .map(item => {
        const medication = item.MedicationAvailability.Medication;
        
        // Build active substances with strength
        const activeSubstances = medication.Medication_MedicationIngredient
          .map(mi => {
            const ingredient = mi.MedicationIngredient;
            const substance = ingredient.ActiveSubstance.name;
            const strength = ingredient.strengthValue && ingredient.strengthUnit 
              ? ` ${ingredient.strengthValue}${ingredient.strengthUnit}`
              : '';
            return substance + strength;
          })
          .join(', ');

        return {
          id: item.id,
          medication: {
            brandName: medication.brandName,
            form: medication.form,
            packSize: medication.packSizeExpression && medication.packSizeUnit
              ? `${medication.packSizeExpression} ${medication.packSizeUnit}`
              : '',
            activeSubstances,
            displayName: `${medication.brandName} ${activeSubstances ? `(${activeSubstances})` : ''} ${medication.form ?? ''}`.trim(),
          },
          pharmacy: {
            name: item.MedicationAvailability.Pharmacy.name,
            address: item.MedicationAvailability.Pharmacy.address,
          },
          quantity: item.quantity,
          price: item.price,
        };
      }),
  }));

  return {
    orders: formattedOrders,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Fetch single order by ID
 */
async function fetchOrderById(pharmacyId, orderId) {
  const order = await repository.findOrderById(pharmacyId, orderId);

  if (!order) {
    const error = new Error('Order not found or you do not have access to this order');
    error.status = HTTP_STATUS.NOT_FOUND;
    throw error;
  }

  // Calculate S/N (serial number) for this pharmacy
  const allPharmacyOrderIds = await repository.getAllOrderIds(pharmacyId);
  const orderPositionMap = new Map(
    allPharmacyOrderIds.map((o, index) => [o.id, index + 1])
  );

  // Format the order
  const formattedOrder = {
    id: order.id,
    sn: orderPositionMap.get(order.id),
    name: order.name,
    phone: order.phone,
    email: order.email,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    trackingCode: order.trackingCode,
    userIdentifier: order.userIdentifier,
    deliveryMethod: order.deliveryMethod,
    address: order.address,
    status: order.status,
    totalPrice: order.totalPrice,
    pharmacyAmount: order.pharmacyAmount,
    paymentReference: order.paymentReference,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paymentChannel: order.paymentChannel,
    filledAt: order.filledAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    
    prescription: order.Prescription
      ? { 
          id: order.Prescription.id, 
          fileUrl: order.Prescription.fileUrl, 
          status: order.Prescription.status,
          createdAt: order.Prescription.createdAt
        }
      : null,
    
    items: order.OrderItem.map(item => {
      const medication = item.MedicationAvailability.Medication;
      
      // Build active substances with strength
      const activeSubstances = medication.Medication_MedicationIngredient
        .map(mi => {
          const ingredient = mi.MedicationIngredient;
          const substance = ingredient.ActiveSubstance.name;
          const strength = ingredient.strengthValue && ingredient.strengthUnit 
            ? ` ${ingredient.strengthValue}${ingredient.strengthUnit}`
            : '';
          return substance + strength;
        })
        .join(', ');

      return {
        id: item.id,
        orderId: order.id,
        quantity: item.quantity,
        price: item.price,
        medication: {
          id: medication.id,
          brandName: medication.brandName,
          form: medication.form,
          packSize: medication.packSizeExpression && medication.packSizeUnit
            ? `${medication.packSizeExpression} ${medication.packSizeUnit}`
            : '',
          activeSubstances,
          displayName: `${medication.brandName} ${activeSubstances ? `(${activeSubstances})` : ''} ${medication.form ?? ''}`.trim(),
        },
      };
    }),
    
    pharmacy: order.OrderItem[0]?.MedicationAvailability?.Pharmacy || null,
  };

  return formattedOrder;
}

/**
 * Update order status
 */
async function updateOrderStatus(orderId, status, pharmacyId) {
  const refundService = require('../../../services/refundService');
  const { sendOrderRejectionNotification } = require('../../../utils/notifications');
  const { createAuditLog, ENTITY_TYPES } = require('../../../utils/audit-logger');
  
  // Find the order that belongs to the given pharmacy
  const order = await repository.findOrderForUpdate(orderId, pharmacyId);

  if (!order) {
    throw new Error('Order not found for pharmacy');
  }

  // Check if this is a rejection of a paid order
  const isRejection = status === 'CANCELLED';
  const isPaidOrder = order.paymentStatus === 'PAID';
  const needsAutoRefund = isRejection && isPaidOrder;

  if (needsAutoRefund) {
    console.log(`⚠️  Pharmacy ${pharmacyId} rejecting PAID order ${orderId} - initiating auto-refund...`);
    
    // Use transaction to ensure atomicity
    return await prisma.$transaction(async (tx) => {
      // 1. Update order status
      const updateData = { 
        status,
        cancelledAt: new Date(),
        cancelReason: `Pharmacy rejected order`
      };

      const updatedOrder = await repository.updateOrderStatusWithTransaction(orderId, pharmacyId, updateData, tx);

      // 2. Restore stock for all order items
      console.log(`📦 Restoring stock for ${order.OrderItem.length} items...`);
      
      for (const item of order.OrderItem) {
        await repository.restoreStock(item.medicationId, item.pharmacyId, item.quantity, tx);
        console.log(`  ✅ Restored ${item.quantity}x ${item.MedicationAvailability.Medication.brandName}`);
      }

      // 3. Create automatic refund
      console.log('💰 Creating automatic refund...');
      
      const refund = await repository.createRefund({
        amount: order.totalPrice,
        reason: `Pharmacy rejected order`,
        refundType: 'AUTOMATIC',
        status: 'PENDING',
        initiatedBy: pharmacyId,
        orderId: orderId
      }, tx);

      console.log(`✅ Refund created: ID ${refund.id}, Amount: ${order.totalPrice}`);

      // 4. Create audit log
      await createAuditLog({
        action: 'PHARMACY_ORDER_REJECTED',
        entityType: ENTITY_TYPES.ORDER,
        entityId: orderId,
        userId: null,
        details: {
          pharmacyId,
          pharmacyName: order.Pharmacy?.name,
          refundId: refund.id,
          refundAmount: order.totalPrice.toString(),
          itemsCount: order.OrderItem.length,
          stockRestored: true
        },
        tx
      }).catch(err => console.warn('Failed to create audit log:', err));

      // 5. Send notifications (async, don't block transaction)
      setImmediate(async () => {
        try {
          await sendOrderRejectionNotification(order, refund);
        } catch (error) {
          console.error('Failed to send rejection notification:', error);
        }
      });

      // 6. Auto-process refund (async, don't block transaction)
      setImmediate(async () => {
        try {
          console.log('🤖 Auto-processing refund...');
          await refundService.processRefund(refund.id);
        } catch (error) {
          console.error('Failed to auto-process refund:', error);
        }
      });

      console.log(`✅ Order ${orderId} rejected with auto-refund and stock restoration`);
      
      return updatedOrder;
    });
  }

  // Normal status update (no refund needed)
  const updateData = { status };

  // Set filledAt timestamp for completed statuses
  if (status === 'DELIVERED' || status === 'READY_FOR_PICKUP') {
    updateData.filledAt = new Date();
  }

  // Update order record
  const updatedOrder = await repository.updateOrderStatus(orderId, updateData);

  console.log('Order status updated:', { 
    orderId, 
    status: updatedOrder.status, 
    filledAt: updatedOrder.filledAt,
    pharmacyId 
  });

  return updatedOrder;
}

/**
 * Bulk update order status
 */
async function bulkUpdateOrderStatus(orderIds, status, pharmacyId, cancelReason) {
  const refundService = require('../../../services/refundService');
  const { sendOrderRejectionNotification } = require('../../../utils/notifications');
  const { createAuditLog, ENTITY_TYPES } = require('../../../utils/audit-logger');
  
  const results = {
    successful: [],
    failed: []
  };

  // Process each order
  for (const orderId of orderIds) {
    try {
      const order = await repository.findOrderForUpdate(orderId, pharmacyId);

      if (!order) {
        results.failed.push({
          orderId,
          reason: 'Order not found for pharmacy'
        });
        continue;
      }

      // Check if already in this status
      if (order.status === status) {
        results.failed.push({
          orderId,
          reason: `Order already in ${status} status`
        });
        continue;
      }

      // Check if this is a rejection of a paid order
      const isRejection = status === 'CANCELLED';
      const isPaidOrder = order.paymentStatus === 'PAID';
      const needsAutoRefund = isRejection && isPaidOrder;

      if (needsAutoRefund) {
        console.log(`⚠️  Pharmacy ${pharmacyId} rejecting PAID order ${orderId} - initiating auto-refund...`);
        
        // Use transaction to ensure atomicity
        const updatedOrder = await prisma.$transaction(async (tx) => {
          const updateData = { 
            status,
            cancelledAt: new Date(),
            cancelReason: cancelReason || `Pharmacy rejected order (bulk action)`
          };

          const updated = await repository.updateOrderStatusWithTransaction(orderId, pharmacyId, updateData, tx);

          // Restore stock for all order items
          console.log(`📦 Restoring stock for ${order.OrderItem.length} items (Order ${orderId})...`);
          
          for (const item of order.OrderItem) {
            await repository.restoreStock(item.medicationId, item.pharmacyId, item.quantity, tx);
            console.log(`  ✅ Restored ${item.quantity}x ${item.MedicationAvailability.Medication.brandName}`);
          }

          // Create automatic refund
          console.log(`💰 Creating automatic refund for order ${orderId}...`);
          
          const refund = await repository.createRefund({
            amount: order.totalPrice,
            reason: cancelReason || `Pharmacy rejected order (bulk action)`,
            refundType: 'AUTOMATIC',
            status: 'PENDING',
            initiatedBy: pharmacyId,
            orderId: orderId
          }, tx);

          console.log(`✅ Refund created: ID ${refund.id}, Amount: ${order.totalPrice}`);

          // Create audit log
          await createAuditLog({
            action: 'PHARMACY_ORDER_REJECTED',
            entityType: ENTITY_TYPES.ORDER,
            entityId: orderId,
            userId: null,
            details: {
              pharmacyId,
              pharmacyName: order.Pharmacy?.name,
              refundId: refund.id,
              refundAmount: order.totalPrice.toString(),
              itemsCount: order.OrderItem.length,
              stockRestored: true,
              bulkAction: true
            },
            tx
          }).catch(err => console.warn('Failed to create audit log:', err));

          // Send notifications (async)
          setImmediate(async () => {
            try {
              await sendOrderRejectionNotification(order, refund);
            } catch (error) {
              console.error(`Failed to send rejection notification for order ${orderId}:`, error);
            }
          });

          // Auto-process refund (async)
          setImmediate(async () => {
            try {
              console.log(`🤖 Auto-processing refund for order ${orderId}...`);
              await refundService.processRefund(refund.id);
            } catch (error) {
              console.error(`Failed to auto-process refund for order ${orderId}:`, error);
            }
          });

          console.log(`✅ Order ${orderId} rejected with auto-refund and stock restoration`);
          
          return updated;
        });

        results.successful.push({
          orderId,
          previousStatus: order.status,
          newStatus: status,
          refundInitiated: true,
          stockRestored: true
        });

      } else {
        // Normal status update (no refund needed)
        const updateData = { status };

        // Set filledAt timestamp for completed statuses
        if (status === 'DELIVERED' || status === 'READY_FOR_PICKUP') {
          updateData.filledAt = new Date();
        }

        // If cancelling non-paid order, still restore stock
        if (status === 'CANCELLED') {
          await prisma.$transaction(async (tx) => {
            await tx.order.update({
              where: { id: orderId },
              data: {
                ...updateData,
                cancelledAt: new Date(),
                cancelReason: cancelReason || `Pharmacy cancelled order (bulk action)`
              }
            });

            // Restore stock
            for (const item of order.OrderItem) {
              await repository.restoreStock(item.medicationId, item.pharmacyId, item.quantity, tx);
            }
          });

          results.successful.push({
            orderId,
            previousStatus: order.status,
            newStatus: status,
            refundInitiated: false,
            stockRestored: true
          });

        } else {
          // Regular status update
          await repository.updateOrderStatus(orderId, updateData);

          results.successful.push({
            orderId,
            previousStatus: order.status,
            newStatus: status,
            refundInitiated: false,
            stockRestored: false
          });
        }

        console.log(`Order ${orderId} status updated:`, { 
          orderId, 
          previousStatus: order.status,
          newStatus: status, 
          filledAt: updateData.filledAt,
          pharmacyId 
        });
      }

    } catch (error) {
      console.error(`❌ Error updating order ${orderId}:`, error);
      results.failed.push({
        orderId,
        reason: error.message || 'Unknown error'
      });
    }
  }

  console.log(`\n📊 Bulk update summary: ${results.successful.length} successful, ${results.failed.length} failed`);
  
  if (results.successful.length > 0) {
    console.log(`✅ Successfully updated orders: ${results.successful.map(r => r.orderId).join(', ')}`);
  }
  if (results.failed.length > 0) {
    console.log(`❌ Failed orders: ${results.failed.map(r => `${r.orderId} (${r.reason})`).join(', ')}`);
  }
  
  return results;
}

/**
 * Reject order and trigger automatic refund
 */
async function rejectOrder(orderId, pharmacyId, reason) {
  try {
    console.log(`🚫 Pharmacy ${pharmacyId} rejecting order ${orderId}...`);

    // Verify order belongs to pharmacy
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        OrderItem: {
          where: { pharmacyId: pharmacyId }
        }
      }
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.OrderItem.length === 0) {
      throw new Error(`Order ${orderId} does not belong to pharmacy ${pharmacyId}`);
    }

    if (order.status === 'CANCELLED') {
      throw new Error(`Order ${orderId} is already cancelled`);
    }

    if (order.status === 'DELIVERED') {
      throw new Error(`Cannot reject delivered order ${orderId}`);
    }

    // Update order status
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: `Rejected by pharmacy: ${reason}`
      }
    });

    console.log(`✅ Order ${orderId} cancelled`);

    // Trigger automatic refund if order was paid
    if (order.paymentStatus === 'PAID') {
      console.log(`💰 Triggering automatic refund for order ${orderId}...`);
      
      const refundService = require('../../../services/refundService');
      
      await refundService.createRefund({
        orderId: orderId,
        amount: order.totalPrice,
        reason: `Order rejected by pharmacy: ${reason}`,
        refundType: 'AUTOMATIC',
        initiatedBy: pharmacyId
      });

      console.log(`✅ Automatic refund triggered for order ${orderId}`);
    } else {
      console.log(`⚠️  Order ${orderId} was not paid, no refund needed`);
    }

    return order;

  } catch (error) {
    console.error('❌ Error rejecting order:', error);
    throw error;
  }
}

module.exports = {
  fetchOrders,
  fetchOrderById,
  updateOrderStatus,
  bulkUpdateOrderStatus,
  rejectOrder,
};