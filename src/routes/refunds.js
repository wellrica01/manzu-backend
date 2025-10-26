/**
 * REFUND ROUTES
 * 
 * Endpoints:
 * - POST /api/refunds - Create refund request (user/pharmacy)
 * - GET /api/refunds/:id - Get refund status
 * - GET /api/orders/:orderId/refunds - Get order refunds
 * - POST /api/admin/refunds/:id/approve - Approve refund (admin)
 * - POST /api/admin/refunds/:id/retry - Retry failed refund (admin)
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const refundService = require('../services/refundService');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { reportError, ErrorCategory } = require('../utils/error-reporter');

console.log('Loaded refunds.js version: 2025-10-25-v1');

/**
 * POST /api/refunds - Create refund request
 * 
 * Body:
 * {
 *   orderId: number,
 *   amount?: number (for partial refunds),
 *   reason: string,
 *   refundType: 'FULL' | 'PARTIAL' | 'MANUAL'
 * }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { orderId, amount, reason, refundType } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!orderId) {
      return res.status(400).json({
        message: 'Order ID is required',
        error: 'MISSING_ORDER_ID'
      });
    }

    if (!reason) {
      return res.status(400).json({
        message: 'Refund reason is required',
        error: 'MISSING_REASON'
      });
    }

    if (!refundType || !['FULL', 'PARTIAL', 'MANUAL'].includes(refundType)) {
      return res.status(400).json({
        message: 'Invalid refund type. Must be FULL, PARTIAL, or MANUAL',
        error: 'INVALID_REFUND_TYPE'
      });
    }

    if (refundType === 'PARTIAL' && !amount) {
      return res.status(400).json({
        message: 'Amount is required for partial refunds',
        error: 'MISSING_AMOUNT'
      });
    }

    // Verify user owns the order
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      select: { userId: true }
    });

    if (!order) {
      return res.status(404).json({
        message: 'Order not found',
        error: 'ORDER_NOT_FOUND'
      });
    }

    if (order.userId !== userId) {
      return res.status(403).json({
        message: 'You do not have permission to refund this order',
        error: 'FORBIDDEN'
      });
    }

    // Create refund
    const refund = await refundService.createRefund({
      orderId: parseInt(orderId),
      amount: amount ? parseFloat(amount) : null,
      reason: reason,
      refundType: refundType,
      initiatedBy: userId
    });

    res.status(201).json({
      message: 'Refund request created successfully',
      refund: {
        id: refund.id,
        orderId: refund.orderId,
        amount: refund.amount,
        status: refund.status,
        refundType: refund.refundType,
        createdAt: refund.createdAt
      }
    });

  } catch (error) {
    console.error('Error creating refund:', error);
    
    reportError(error, {
      category: ErrorCategory.BUSINESS_LOGIC,
      customContext: {
        userId: req.user?.id,
        body: req.body
      }
    });

    res.status(500).json({
      message: error.message || 'Failed to create refund request',
      error: 'REFUND_CREATION_FAILED'
    });
  }
});

/**
 * GET /api/refunds/:id - Get refund status
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const refundId = parseInt(req.params.id);
    const userId = req.user.id;

    const refund = await refundService.getRefundStatus(refundId);

    if (!refund) {
      return res.status(404).json({
        message: 'Refund not found',
        error: 'REFUND_NOT_FOUND'
      });
    }

    // Verify user owns the order (unless admin)
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      const order = await prisma.order.findUnique({
        where: { id: refund.orderId },
        select: { userId: true }
      });

      if (order.userId !== userId) {
        return res.status(403).json({
          message: 'You do not have permission to view this refund',
          error: 'FORBIDDEN'
        });
      }
    }

    res.status(200).json({
      refund: {
        id: refund.id,
        orderId: refund.orderId,
        amount: refund.amount,
        reason: refund.reason,
        refundType: refund.refundType,
        status: refund.status,
        paystackRefundId: refund.paystackRefundId,
        processedAt: refund.processedAt,
        createdAt: refund.createdAt,
        order: refund.order
      }
    });

  } catch (error) {
    console.error('Error getting refund status:', error);
    
    res.status(500).json({
      message: 'Failed to get refund status',
      error: 'REFUND_STATUS_FAILED'
    });
  }
});

/**
 * GET /api/orders/:orderId/refunds - Get all refunds for an order
 */
router.get('/orders/:orderId/refunds', authenticate, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const userId = req.user.id;

    // Verify user owns the order (unless admin)
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { userId: true }
      });

      if (!order) {
        return res.status(404).json({
          message: 'Order not found',
          error: 'ORDER_NOT_FOUND'
        });
      }

      if (order.userId !== userId) {
        return res.status(403).json({
          message: 'You do not have permission to view refunds for this order',
          error: 'FORBIDDEN'
        });
      }
    }

    const refunds = await refundService.getOrderRefunds(orderId);

    res.status(200).json({
      refunds: refunds.map(refund => ({
        id: refund.id,
        amount: refund.amount,
        reason: refund.reason,
        refundType: refund.refundType,
        status: refund.status,
        processedAt: refund.processedAt,
        createdAt: refund.createdAt
      }))
    });

  } catch (error) {
    console.error('Error getting order refunds:', error);
    
    res.status(500).json({
      message: 'Failed to get order refunds',
      error: 'ORDER_REFUNDS_FAILED'
    });
  }
});

/**
 * POST /api/admin/refunds/:id/approve - Approve manual refund (admin only)
 */
router.post('/admin/:id/approve', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const refundId = parseInt(req.params.id);
    const adminId = req.user.id;

    const refund = await refundService.approveRefund(refundId, adminId);

    res.status(200).json({
      message: 'Refund approved and processing',
      refund: {
        id: refund.id,
        status: refund.status,
        approvedBy: refund.approvedBy,
        approvedAt: refund.approvedAt
      }
    });

  } catch (error) {
    console.error('Error approving refund:', error);
    
    reportError(error, {
      category: ErrorCategory.BUSINESS_LOGIC,
      customContext: {
        adminId: req.user?.id,
        refundId: req.params.id
      }
    });

    res.status(500).json({
      message: error.message || 'Failed to approve refund',
      error: 'REFUND_APPROVAL_FAILED'
    });
  }
});

/**
 * POST /api/admin/refunds/:id/retry - Retry failed refund (admin only)
 */
router.post('/admin/:id/retry', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const refundId = parseInt(req.params.id);

    const refund = await refundService.retryFailedRefund(refundId);

    res.status(200).json({
      message: 'Refund retry initiated',
      refund: {
        id: refund.id,
        status: refund.status
      }
    });

  } catch (error) {
    console.error('Error retrying refund:', error);
    
    res.status(500).json({
      message: error.message || 'Failed to retry refund',
      error: 'REFUND_RETRY_FAILED'
    });
  }
});

/**
 * GET /api/admin/refunds - Get all refunds (admin only)
 */
router.get('/admin/refunds', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const where = status ? { status: status } : {};

    const refunds = await prisma.refund.findMany({
      where: where,
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    const total = await prisma.refund.count({ where });

    res.status(200).json({
      refunds: refunds,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error getting refunds:', error);
    
    res.status(500).json({
      message: 'Failed to get refunds',
      error: 'REFUNDS_FETCH_FAILED'
    });
  }
});

module.exports = router;
