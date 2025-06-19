async function recalculateOrderTotal(prisma, orderId) {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { price: true, quantity: true, pharmacyMedicationPharmacyId: true },
  });

  // Calculate total for the entire order
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Calculate per-pharmacy subtotals (optional for frontend)
  const subtotals = items.reduce((acc, item) => {
    const pharmacyId = item.pharmacyMedicationPharmacyId;
    acc[pharmacyId] = (acc[pharmacyId] || 0) + item.price * item.quantity;
    return acc;
  }, {});

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: { totalPrice: total, updatedAt: new Date() },
  });

  return { updatedOrder, subtotals };
}

module.exports = { recalculateOrderTotal };