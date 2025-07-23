const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function recordConsent({ userIdentifier, userId, consentType, granted }) {
  if (userIdentifier) {
    // User consent
    const consent = await prisma.userConsent.upsert({
      where: {
        userIdentifier_consentType: {
          userIdentifier,
          consentType,
        },
      },
      update: {
        granted,
        createdAt: new Date(),
      },
      create: {
        userIdentifier,
        consentType,
        granted,
        createdAt: new Date(),
      },
    });
    return consent;
  } else if (userId) {
    // Pharmacy user consent
    const consent = await prisma.pharmacyUserConsent.upsert({
      where: {
        userId_consentType: {
          userId,
          consentType,
        },
      },
      update: {
        granted,
        createdAt: new Date(),
      },
      create: {
        userId,
        consentType,
        granted,
        createdAt: new Date(),
      },
    });
    return consent;
  } else {
    throw new Error('Either userIdentifier or userId must be provided.');
  }
}

module.exports = { recordConsent };