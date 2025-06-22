async function recalculateBookingTotal(prisma, bookingId) {
  const items = await prisma.bookingItem.findMany({
    where: { bookingId },
    select: { price: true, labTestLabId: true },
  });

  // Calculate total for the entire booking
  const total = items.reduce((sum, item) => sum + item.price, 0);

  // Calculate per-lab subtotals (optional for frontend)
  const subtotals = items.reduce((acc, item) => {
    const labId = item.labTestLabId;
    acc[labId] = (acc[labId] || 0) + item.price;
    return acc;
  }, {});

  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: { totalPrice: total, updatedAt: new Date() },
  });

  return { updatedBooking, subtotals };
}

module.exports = { recalculateBookingTotal };