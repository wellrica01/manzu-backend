/**
 * PHARMACY PAYOUTS SERVICE
 * 
 * Business logic for processing pharmacy payouts
 */

const repository = require('./pharmacy-payouts.repository');
const prisma = require('../../../core/database/prisma');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { createAuditLog } = require('../../../utils/audit-logger');
const { reportError, ErrorCategory } = require('../../../utils/error-reporter');

// Audit actions for payouts
const AUDIT_ACTIONS = {
  PAYOUT_INITIATED: 'PAYOUT_INITIATED',
  PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
  PAYOUT_FAILED: 'PAYOUT_FAILED',
  PAYOUT_RETRIED: 'PAYOUT_RETRIED',
};

const ENTITY_TYPES = {
  PAYOUT: 'Payout',
  ORDER: 'Order',
};

/**
 * Initiate Paystack transfer
 */
async function initiatePaystackTransfer(recipientCode, amount, reference, reason) {
  try {
    const response = await axios.post(
      'https://api.paystack.co/transfer',
      {
        source: 'balance',
        amount: Math.round(amount * 100), // Convert to kobo
        recipient: recipientCode,
        reason,
        reference,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (response.data.status && response.data.data) {
      return {
        success: true,
        transferCode: response.data.data.transfer_code,
        reference: response.data.data.reference,
      };
    }

    return { 
      success: false, 
      error: response.data.message || 'Transfer initiation failed' 
    };
  } catch (error) {
    console.error('Paystack transfer error:', error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Transfer failed',
    };
  }
}

/**
 * Process batch payout for a pharmacy
 */
async function processBatchPayout(pharmacyId, orderIds) {
  console.log(`Processing batch payout for pharmacy ${pharmacyId}...`);

  // Get pharmacy banking details
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: {
      id: true,
      name: true,
      recipientCode: true,
    },
  });

  if (!pharmacy) {
    throw new Error(`Pharmacy ${pharmacyId} not found`);
  }

  if (!pharmacy.recipientCode) {
    const error = new Error(`Pharmacy ${pharmacy.name} has no banking setup`);
    console.error(error.message);
    
    // Report to admin
    reportError(error, {
      category: ErrorCategory.SYSTEM,
      customContext: {
        pharmacyId,
        pharmacyName: pharmacy.name,
        orderCount: orderIds.length,
      },
    });
    
    throw error;
  }

  // Calculate total payout amount
  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds },
      pharmacyId,
      status: 'COMPLETED',
      payoutStatus: 'PENDING',
    },
  });

  if (orders.length === 0) {
    throw new Error('No eligible orders found for payout');
  }

  const totalAmount = orders.reduce((sum, order) => sum + (order.pharmacyAmount || 0), 0);
  const payoutReference = `PAYOUT_${pharmacyId}_${Date.now()}_${uuidv4().slice(0, 8)}`;

  // Create payout record and initiate transfer
  const result = await prisma.$transaction(async (tx) => {
    // Create payout record
    const payout = await repository.createPayout(
      {
        pharmacyId,
        amount: totalAmount,
        orderIds,
        reference: payoutReference,
      },
      tx
    );

    // Update orders to PROCESSING status
    await repository.updateOrdersPayoutStatus(
      orderIds,
      'PROCESSING',
      {
        payoutReference: payoutReference,
        payoutInitiatedAt: new Date(),
      },
      tx
    );

    // Audit log
    await createAuditLog({
      action: AUDIT_ACTIONS.PAYOUT_INITIATED,
      entityType: ENTITY_TYPES.PAYOUT,
      entityId: payout.id,
      details: {
        pharmacyId,
        pharmacyName: pharmacy.name,
        amount: totalAmount.toString(),
        orderCount: orderIds.length,
        reference: payoutReference,
      },
      tx,
    });

    return payout;
  });

  // Initiate Paystack transfer (outside transaction to avoid long locks)
  const transfer = await initiatePaystackTransfer(
    pharmacy.recipientCode,
    totalAmount,
    payoutReference,
    `Payout for ${orders.length} order(s) - ${pharmacy.name}`
  );

  if (transfer.success) {
    // Update payout status to PROCESSING
    await prisma.$transaction(async (tx) => {
      await repository.updatePayoutStatus(
        result.id,
        'PROCESSING',
        {
          paystackResponse: transfer,
        },
        tx
      );
    });

    console.log(`✅ Payout initiated successfully: ${payoutReference}`);
    return { success: true, payout: result, transfer };
  } else {
    // Transfer failed - mark as FAILED
    await prisma.$transaction(async (tx) => {
      await repository.updatePayoutStatus(
        result.id,
        'FAILED',
        {
          failureReason: transfer.error,
        },
        tx
      );

      // Revert orders back to PENDING
      await repository.updateOrdersPayoutStatus(
        orderIds,
        'PENDING',
        {
          payoutReference: null,
          payoutInitiatedAt: null,
        },
        tx
      );

      // Audit log
      await createAuditLog({
        action: AUDIT_ACTIONS.PAYOUT_FAILED,
        entityType: ENTITY_TYPES.PAYOUT,
        entityId: result.id,
        details: {
          pharmacyId,
          amount: totalAmount.toString(),
          error: transfer.error,
        },
        tx,
      });
    });

    console.error(`❌ Payout failed: ${transfer.error}`);
    
    // Report error
    reportError(new Error(transfer.error), {
      category: ErrorCategory.SYSTEM,
      customContext: {
        pharmacyId,
        pharmacyName: pharmacy.name,
        amount: totalAmount,
        reference: payoutReference,
      },
    });

    throw new Error(`Payout failed: ${transfer.error}`);
  }
}

/**
 * Handle payout webhook (called from Paystack webhook)
 */
async function handlePayoutWebhook(eventData) {
  const { reference, status, recipient_code } = eventData;

  console.log(`Webhook received for payout: ${reference}, status: ${status}`);

  const payout = await repository.findPayoutByReference(reference);

  if (!payout) {
    console.error(`Payout not found for reference: ${reference}`);
    return;
  }

  if (status === 'success') {
    // Mark payout as COMPLETED
    await prisma.$transaction(async (tx) => {
      await repository.updatePayoutStatus(
        payout.id,
        'COMPLETED',
        {
          completedAt: new Date(),
          paystackResponse: eventData,
        },
        tx
      );

      // Update all related orders
      await repository.updateOrdersPayoutStatus(
        payout.orderIds,
        'COMPLETED',
        {
          payoutCompletedAt: new Date(),
        },
        tx
      );

      // Audit log
      await createAuditLog({
        action: AUDIT_ACTIONS.PAYOUT_COMPLETED,
        entityType: ENTITY_TYPES.PAYOUT,
        entityId: payout.id,
        details: {
          pharmacyId: payout.pharmacyId,
          amount: payout.amount.toString(),
          orderCount: payout.orderIds.length,
          reference,
        },
        tx,
      });
    });

    console.log(`✅ Payout completed: ${reference}`);
  } else if (status === 'failed') {
    // Mark payout as FAILED
    await prisma.$transaction(async (tx) => {
      await repository.updatePayoutStatus(
        payout.id,
        'FAILED',
        {
          failureReason: eventData.message || 'Transfer failed',
          paystackResponse: eventData,
        },
        tx
      );

      // Revert orders to PENDING for retry
      await repository.updateOrdersPayoutStatus(
        payout.orderIds,
        'PENDING',
        {
          payoutReference: null,
        },
        tx
      );

      // Audit log
      await createAuditLog({
        action: AUDIT_ACTIONS.PAYOUT_FAILED,
        entityType: ENTITY_TYPES.PAYOUT,
        entityId: payout.id,
        details: {
          pharmacyId: payout.pharmacyId,
          amount: payout.amount.toString(),
          error: eventData.message,
          reference,
        },
        tx,
      });
    });

    console.error(`❌ Payout failed: ${reference}`);
    
    // Report error
    reportError(new Error(eventData.message || 'Payout failed'), {
      category: ErrorCategory.SYSTEM,
      customContext: {
        pharmacyId: payout.pharmacyId,
        pharmacyName: payout.Pharmacy.name,
        amount: payout.amount,
        reference,
      },
    });
  }
}

/**
 * Retry failed payout
 */
async function retryFailedPayout(payoutId) {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: {
      Pharmacy: {
        select: {
          recipientCode: true,
          name: true,
        },
      },
    },
  });

  if (!payout) {
    throw new Error('Payout not found');
  }

  if (payout.status !== 'FAILED') {
    throw new Error('Only failed payouts can be retried');
  }

  if (!payout.Pharmacy.recipientCode) {
    throw new Error('Pharmacy has no banking setup');
  }

  // Create new reference for retry
  const retryReference = `${payout.reference}_RETRY_${Date.now()}`;

  // Initiate transfer
  const transfer = await initiatePaystackTransfer(
    payout.Pharmacy.recipientCode,
    payout.amount,
    retryReference,
    `Retry: ${payout.Pharmacy.name}`
  );

  if (transfer.success) {
    await prisma.$transaction(async (tx) => {
      await repository.updatePayoutStatus(
        payoutId,
        'PROCESSING',
        {
          reference: retryReference,
          paystackResponse: transfer,
        },
        tx
      );

      await repository.updateOrdersPayoutStatus(
        payout.orderIds,
        'PROCESSING',
        {
          payoutReference: retryReference,
        },
        tx
      );

      await createAuditLog({
        action: AUDIT_ACTIONS.PAYOUT_RETRIED,
        entityType: ENTITY_TYPES.PAYOUT,
        entityId: payoutId,
        details: {
          originalReference: payout.reference,
          retryReference,
          pharmacyId: payout.pharmacyId,
        },
        tx,
      });
    });

    console.log(`✅ Payout retry initiated: ${retryReference}`);
    return { success: true, reference: retryReference };
  } else {
    console.error(`❌ Payout retry failed: ${transfer.error}`);
    throw new Error(`Retry failed: ${transfer.error}`);
  }
}

/**
 * Get payout summary for pharmacy dashboard
 */
async function getPayoutSummary(pharmacyId) {
  return await repository.getPayoutSummary(pharmacyId);
}

/**
 * Get payout history for pharmacy
 */
async function getPayoutHistory(pharmacyId, pagination) {
  return await repository.getPayoutHistory(pharmacyId, pagination);
}

/**
 * Get orders pending payout
 */
async function getOrdersPendingPayout(pharmacyId) {
  return await repository.findOrdersReadyForPayout(pharmacyId);
}

module.exports = {
  processBatchPayout,
  handlePayoutWebhook,
  retryFailedPayout,
  getPayoutSummary,
  getPayoutHistory,
  getOrdersPendingPayout,
};