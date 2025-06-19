const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function registerDevice(deviceToken, pharmacyId, userId) {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
  });
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }

  await prisma.pharmacy.update({
    where: { id: pharmacyId },
    data: { deviceToken },
  });

  console.log('Device token registered:', { pharmacyId, userId });
}

module.exports = { registerDevice };