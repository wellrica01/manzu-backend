const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function recalculateOrderTotal(orderId) {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { price: true, quantity: true, providerId: true },
  });

  // Calculate total for the entire order
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Calculate per-provider subtotals (optional for frontend)
  const subtotals = items.reduce((acc, item) => {
    const providerId = item.providerId;
    acc[providerId] = (acc[providerId] || 0) + item.price * item.quantity;
    return acc;
  }, {});

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: { totalPrice: total, updatedAt: new Date() },
  });

  return { updatedOrder, subtotals };
}

module.exports = { recalculateOrderTotal };