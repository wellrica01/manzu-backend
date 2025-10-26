/**
 * REFUND SERVICE
 * 
 * Handles complete refund workflow:
 * - Automatic refunds (pharmacy rejection)
 * - Manual refunds (admin approval)
 * - Paystack API integration
 * - Stock restoration
 * - Notifications
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const { reportError, ErrorCategory } = require('../utils/error-reporter');
const { createAuditLog, AUDIT_ACTIONS, ENTITY_TYPES } = require('../utils/audit-logger');
const { alertRefundProcessingFailed, alertPaymentGatewayDown } = require('../utils/error-reporter');

/**
 * Paystack Refund API Configuration
 */
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_REFUND_URL = 'https://api.paystack.co/refund';

/**
 * Create a refund request
 */
async function createRefund({ orderId, amount, reason, refundType, initiatedBy }) {
  try {
    console.log(`📝 Creating refund for order ${orderId}:`, { amount, reason, refundType });

    // Validate order exists and is eligible for refund
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        OrderItem: true
      }
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Business rule: Only refund PAID orders
    if (order.paymentStatus !== 'PAID') {
      throw new Error(`Order ${orderId} is not paid (status: ${order.paymentStatus})`);
    }

    // Business rule: Check if already refunded
    const existingRefund = await prisma.refund.findFirst({
      where: {
        orderId: orderId,
        status: { in: ['COMPLETED', 'PROCESSING'] }
      }
    });

    if (existingRefund) {
      throw new Error(`Order ${orderId} already has a refund (ID: ${existingRefund.id})`);
    }

    // Calculate refund amount
    let refundAmount = amount;
    if (refundType === 'FULL') {
      refundAmount = order.totalPrice;
    }

    // Business rule: Partial refund cannot exceed order total
    if (refundAmount > order.totalPrice) {
      throw new Error(`Refund amount (${refundAmount}) exceeds order total (${order.totalPrice})`);
    }

    // Create refund record
    const refund = await prisma.refund.create({
      data: {
        amount: refundAmount,
        reason: reason,
        refundType: refundType,
        status: 'PENDING',
        initiatedBy: initiatedBy,
        Order: {
          connect: { id: orderId }
        }
      }
    });

    console.log(`✅ Refund created: ID ${refund.id}, Amount: ${refundAmount}`);

    // Auto-process if AUTOMATIC type
    if (refundType === 'AUTOMATIC') {
      console.log('🤖 Auto-processing refund...');
      await processRefund(refund.id);
    }

    return refund;

  } catch (error) {
    console.error('❌ Error creating refund:', error);
    reportError(error, {
      category: ErrorCategory.BUSINESS_LOGIC,
      customContext: { orderId, amount, reason, refundType }
    });
    throw error;
  }
}


/**
 * Process a refund (call Paystack API)
 */
async function processRefund(refundId) {
  try {
    console.log(`🔄 Processing refund ${refundId}...`);

    // Get refund details with order and items
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        Order: {
          include: {
            OrderItem: {
              include: {
                MedicationAvailability: {
                  include: { Medication: true, Pharmacy: true }
                }
              }
            }
          }
        }
      }
    });

    if (!refund) throw new Error(`Refund ${refundId} not found`);
    if (['COMPLETED', 'PROCESSING'].includes(refund.status)) {
      console.log(`⚠️  Refund ${refundId} already ${refund.status.toLowerCase()}`);
      return refund;
    }

    // Lookup transaction reference
    const txRef = await prisma.transactionReference.findFirst({
      where: { orderReferences: { has: refund.Order.paymentReference } }
    });

    if (!txRef) throw new Error(`No Paystack transaction reference found for order ${refund.orderId}`);

    // Update refund with transaction reference and status
    await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'PROCESSING',
        paystackReference: txRef.transactionReference
      }
    });

    console.log(`💳 Calling Paystack refund API for reference: ${txRef.transactionReference}`);

    // Call Paystack Refund API
    const paystackResponse = await axios.post(
      PAYSTACK_REFUND_URL,
      {
        transaction: txRef.transactionReference,
        amount: Math.round(parseFloat(refund.amount) * 100), // Convert to kobo
        merchant_note: refund.reason
      },
      {
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('✅ Paystack refund response:', paystackResponse.data);

    if (!paystackResponse.data.status) {
      throw new Error(`Paystack refund failed: ${paystackResponse.data.message}`);
    }

    const paystackRefundId = paystackResponse.data.data.id;
    const paystackRefundStatus = paystackResponse.data.data.status;

    // Update refund with Paystack response
    const updatedRefund = await prisma.refund.update({
      where: { id: refundId },
      data: {
        paystackRefundId: paystackRefundId.toString(),
        status: paystackRefundStatus === 'processed' ? 'COMPLETED' : 'PROCESSING',
        processedAt: paystackRefundStatus === 'processed' ? new Date() : null
      }
    });

    // Complete refund if processed
    if (paystackRefundStatus === 'processed') {
      await completeRefund(refundId);
    }

    return updatedRefund;

  } catch (error) {
    console.error(`❌ Refund ${refundId} failed:`, error.message);

    const refundData = await prisma.refund.findUnique({
      where: { id: refundId },
      include: { Order: true }
    });

    if (refundData) {
      alertRefundProcessingFailed(
        refundId,
        refundData.orderId,
        refundData.amount,
        error,
        {
          reason: refundData.reason,
          refundType: refundData.refundType,
          paystackError: error.response?.data?.message || error.message
        }
      );
    }

    // Mark refund as failed
    await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'FAILED',
        processedAt: new Date(),
        paystackResponse: error.response?.data || { error: error.message }
      }
    });

    throw error;
  }
}


/**
 * Complete refund (update order, restore stock, send notifications)
 */
async function completeRefund(refundId) {
  try {
    console.log(`✅ Completing refund ${refundId}...`);

    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        Order: {
          include: {
            OrderItem: true
          }
        }
      }
    });

    if (!refund) {
      throw new Error(`Refund ${refundId} not found`);
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // 1. Update order status
      await tx.order.update({
        where: { id: refund.orderId },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'REFUNDED',
          cancelledAt: new Date(),
          cancelReason: refund.reason
        }
      });

      // 2. Restore stock (only if order was CONFIRMED, not DELIVERED)
      if (refund.Order.status === 'CONFIRMED' || refund.Order.status === 'PENDING') {
        console.log('📦 Restoring stock...');
        
        // Stock restoration using MedicationAvailability table
        for (const item of refund.Order.OrderItem) {
          try {
            await tx.medicationAvailability.update({
              where: {
                pharmacyId_medicationId: {
                  pharmacyId: item.pharmacyId,
                  medicationId: item.medicationId
                }
              },
              data: {
                stock: {
                  increment: item.quantity
                }
              }
            });
            console.log(`✅ Restored ${item.quantity}x medication ${item.medicationId} to pharmacy ${item.pharmacyId}`);
          } catch (error) {
            console.warn(`⚠️  Could not restore stock for item ${item.id}:`, error.message);
          }
        }
      } else {
        console.log(`⚠️  Stock not restored (order status: ${refund.Order.status})`);
      }

      // 3. Update refund status
      await tx.refund.update({
        where: { id: refundId },
        data: {
          status: 'COMPLETED',
          processedAt: new Date()
        }
      });

      // 4. Create audit log
       await createAuditLog({
        action: AUDIT_ACTIONS.REFUND_COMPLETED,
        entityType: ENTITY_TYPES.ORDER,
        entityId: refund.orderId,
        details: {
        refundId: refundId,
        amount: refund.amount.toString(),
        reason: refund.reason,
        refundType: refund.refundType,
        paystackReference: refund.paystackReference
        },
        tx
        });
    });

    console.log(`✅ Refund ${refundId} completed successfully`);

    // 5. Send notifications (outside transaction)
    await sendRefundNotifications(refund);

    return refund;

  } catch (error) {
    console.error('❌ Error completing refund:', error);
    reportError(error, {
      category: ErrorCategory.BUSINESS_LOGIC,
      customContext: { refundId }
    });
    throw error;
  }
}

/**
 * Send refund notifications
 */
async function sendRefundNotifications(refund) {
  try {
    console.log(`📧 Sending refund notifications for refund ${refund.id}...`);

    // Get order details for notification
    const order = await prisma.order.findUnique({
      where: { id: refund.orderId }
    });

    if (!order) {
      console.warn('Order not found for notification');
      return;
    }

    // ✅ Use the notification utility to send emails and SMS
    const { sendRefundCompletionNotification } = require('../utils/notifications');
    await sendRefundCompletionNotification(refund, order);

    console.log('✅ Refund notifications sent');

  } catch (error) {
    console.error('❌ Error sending refund notifications:', error);
    // Don't throw - notifications are not critical
  }
}

/**
 * Get refund status
 */
async function getRefundStatus(refundId) {
  try {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        Order: {
          select: {
            id: true,
            totalPrice: true,
            status: true,
            paymentStatus: true
          }
        }
      }
    });

    if (!refund) {
      throw new Error(`Refund ${refundId} not found`);
    }

    return refund;

  } catch (error) {
    console.error('❌ Error getting refund status:', error);
    throw error;
  }
}

/**
 * Get refunds for an order
 */
async function getOrderRefunds(orderId) {
  try {
    const refunds = await prisma.refund.findMany({
      where: { orderId: orderId },
      orderBy: { createdAt: 'desc' }
    });

    return refunds;

  } catch (error) {
    console.error('❌ Error getting order refunds:', error);
    throw error;
  }
}

/**
 * Approve manual refund (admin only)
 */
async function approveRefund(refundId, approvedBy) {
  try {
    console.log(`✅ Approving refund ${refundId} by ${approvedBy}...`);

    const refund = await prisma.refund.findUnique({
      where: { id: refundId }
    });

    if (!refund) {
      throw new Error(`Refund ${refundId} not found`);
    }

    if (refund.status !== 'PENDING') {
      throw new Error(`Refund ${refundId} is not pending (status: ${refund.status})`);
    }

    if (refund.refundType !== 'MANUAL') {
      throw new Error(`Only MANUAL refunds require approval (type: ${refund.refundType})`);
    }

    // Update refund
    const updatedRefund = await prisma.refund.update({
      where: { id: refundId },
      data: {
        approvedBy: approvedBy,
        approvedAt: new Date()
      }
    });

    // Process refund
    await processRefund(refundId);

    return updatedRefund;

  } catch (error) {
    console.error('❌ Error approving refund:', error);
    reportError(error, {
      category: ErrorCategory.BUSINESS_LOGIC,
      customContext: { refundId, approvedBy }
    });
    throw error;
  }
}

/**
 * Retry failed refund
 */
async function retryFailedRefund(refundId) {
  try {
    console.log(`🔄 Retrying failed refund ${refundId}...`);

    const refund = await prisma.refund.findUnique({
      where: { id: refundId }
    });

    if (!refund) {
      throw new Error(`Refund ${refundId} not found`);
    }

    if (refund.status !== 'FAILED') {
      throw new Error(`Refund ${refundId} is not failed (status: ${refund.status})`);
    }

    // Reset status to PENDING
    await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'PENDING',
        failureReason: null
      }
    });

    // Process refund
    await processRefund(refundId);

    return refund;

  } catch (error) {
    console.error('❌ Error retrying refund:', error);
    throw error;
  }
}

module.exports = {
  createRefund,
  processRefund,
  completeRefund,
  getRefundStatus,
  getOrderRefunds,
  approveRefund,
  retryFailedRefund
};
