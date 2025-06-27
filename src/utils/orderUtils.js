const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Modified recalculateOrderTotal to accept tx
async function recalculateOrderTotal(orderId, tx = prisma) {
  try {
    console.log(`Recalculating totalPrice for order ${orderId}`);
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { price: true, quantity: true, providerId: true, serviceId: true },
    });

    console.log(`Order ${orderId} items:`, items);

    if (!items.length) {
      console.log(`No items found for order ${orderId}, setting totalPrice to 0`);
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { totalPrice: 0, updatedAt: new Date() },
      });
      return { updatedOrder, subtotals: {} };
    }

    const total = items.reduce((sum, item) => {
      const itemTotal = item.price * item.quantity;
      console.log(`Item serviceId: ${item.serviceId}, providerId: ${item.providerId}, price: ${item.price}, quantity: ${item.quantity}, total: ${itemTotal}`);
      return sum + itemTotal;
    }, 0);

    const subtotals = items.reduce((acc, item) => {
      const providerId = item.providerId;
      acc[providerId] = (acc[providerId] || 0) + item.price * item.quantity;
      return acc;
    }, {});

    console.log(`Calculated totalPrice: ${total}, subtotals:`, subtotals);
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: { totalPrice: total, updatedAt: new Date() },
    });
    console.log(`After update - Order ${orderId} totalPrice: ${updatedOrder.totalPrice}`);

    return { updatedOrder, subtotals };
  } catch (error) {
    console.error(`Error recalculating totalPrice for order ${orderId}:`, error);
    throw new Error(`Failed to recalculate order total: ${error.message}`);
  }
}


module.exports = { recalculateOrderTotal };