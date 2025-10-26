/**
 * ADMIN ORDERS SERVICE
 * 
 * Business logic for admin order management
 */

const ordersRepository = require('./admin-orders.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get orders with filters and pagination
 */
async function getOrders({ page, limit, status, userIdentifier }) {
  const skip = (page - 1) * limit;
  const where = {};

  if (status) where.status = status.toUpperCase();
  if (userIdentifier) {
    where.userIdentifier = { contains: userIdentifier, mode: 'insensitive' };
  }

  const [orders, total] = await ordersRepository.findOrders({
    skip,
    limit,
    where,
  });

  console.log('Orders fetched:', { count: orders.length, total });

  return {
    orders,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single order by ID
 */
async function getOrder(id) {
  const order = await ordersRepository.findOrderById(id);

  if (!order) {
    const error = new Error('Order not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  console.log('Order fetched:', { orderId: id });
  return order;
}

module.exports = {
  getOrders,
  getOrder,
};