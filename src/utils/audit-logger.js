/**
 * Centralized Audit Logging Utility
 * 
 * Tracks all critical operations for compliance and security monitoring
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Audit Actions Enum
 */
const AUDIT_ACTIONS = {
  // Order Actions
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  
  // Payment Actions
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  
  // Refund Actions
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_APPROVED: 'REFUND_APPROVED',
  REFUND_REJECTED: 'REFUND_REJECTED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  REFUND_FAILED: 'REFUND_FAILED',
  
  // Prescription Actions
  PRESCRIPTION_UPLOADED: 'PRESCRIPTION_UPLOADED',
  PRESCRIPTION_VERIFIED: 'PRESCRIPTION_VERIFIED',
  PRESCRIPTION_REJECTED: 'PRESCRIPTION_REJECTED',
  PRESCRIPTION_EXPIRED: 'PRESCRIPTION_EXPIRED',
  
  // Stock Actions
  STOCK_RESERVED: 'STOCK_RESERVED',
  STOCK_RELEASED: 'STOCK_RELEASED',
  STOCK_UPDATED: 'STOCK_UPDATED',
  
  // Pharmacy Actions
  PHARMACY_ORDER_ACCEPTED: 'PHARMACY_ORDER_ACCEPTED',
  PHARMACY_ORDER_REJECTED: 'PHARMACY_ORDER_REJECTED',
  PHARMACY_ORDER_FULFILLED: 'PHARMACY_ORDER_FULFILLED',
  
  // Admin Actions
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  ADMIN_LOGOUT: 'ADMIN_LOGOUT',
  ADMIN_ACTION: 'ADMIN_ACTION'
};

/**
 * Entity Types Enum
 */
const ENTITY_TYPES = {
  ORDER: 'Order',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  PRESCRIPTION: 'Prescription',
  STOCK: 'Stock',
  PHARMACY: 'Pharmacy',
  USER: 'User',
  ADMIN: 'Admin'
};

/**
 * Create audit log entry
 * 
 * @param {Object} params - Audit log parameters
 * @param {string} params.action - Action performed (use AUDIT_ACTIONS)
 * @param {string} params.entityType - Type of entity (use ENTITY_TYPES)
 * @param {number} params.entityId - ID of the entity
 * @param {number} [params.userId] - ID of user who performed action
 * @param {Object} [params.details] - Additional details (JSON)
 * @param {string} [params.ipAddress] - IP address of requester
 * @param {string} [params.userAgent] - User agent string
 * @param {Object} [params.tx] - Prisma transaction client (optional)
 * @returns {Promise<Object>} Created audit log entry
 */
async function createAuditLog({
  action,
  entityType,
  entityId,
  userId = null,
  details = {},
  ipAddress = null,
  userAgent = null,
  tx = null
}) {
  try {
    const client = tx || prisma;
    
    const auditLog = await client.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId,
        details,
        ipAddress,
        userAgent
      }
    });
    
    return auditLog;
  } catch (error) {
    // Log error but don't throw - audit logging should never break the main flow
    console.error('❌ Failed to create audit log:', {
      action,
      entityType,
      entityId,
      error: error.message
    });
    return null;
  }
}

/**
 * Extract IP address from request
 */
function getIpAddress(req) {
  return req.ip || 
         req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         null;
}

/**
 * Extract user agent from request
 */
function getUserAgent(req) {
  return req.headers['user-agent']?.substring(0, 500) || null;
}

/**
 * Create audit log from Express request
 * 
 * @param {Object} req - Express request object
 * @param {Object} params - Audit log parameters
 */
async function auditFromRequest(req, params) {
  return createAuditLog({
    ...params,
    ipAddress: getIpAddress(req),
    userAgent: getUserAgent(req),
    userId: req.user?.id || req.userId || null
  });
}

/**
 * Query audit logs with filters
 * 
 * @param {Object} filters - Query filters
 * @returns {Promise<Array>} Audit log entries
 */
async function queryAuditLogs({
  entityType = null,
  entityId = null,
  action = null,
  userId = null,
  startDate = null,
  endDate = null,
  limit = 100,
  offset = 0
}) {
  const where = {};
  
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;
  if (userId) where.userId = userId;
  
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }
  
  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset
  });
}

/**
 * Get audit trail for specific entity
 * 
 * @param {string} entityType - Entity type
 * @param {number} entityId - Entity ID
 * @returns {Promise<Array>} Audit trail
 */
async function getAuditTrail(entityType, entityId) {
  return prisma.auditLog.findMany({
    where: {
      entityType,
      entityId
    },
    orderBy: { createdAt: 'asc' }
  });
}

module.exports = {
  createAuditLog,
  auditFromRequest,
  queryAuditLogs,
  getAuditTrail,
  getIpAddress,
  getUserAgent,
  AUDIT_ACTIONS,
  ENTITY_TYPES
};