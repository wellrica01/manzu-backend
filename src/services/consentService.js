const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function recordConsent({ patientIdentifier, userId, consentType, granted }) {
  const consent = await prisma.consent.upsert({
    where: {
      patientidentifier_consenttype: {
        patientidentifier: patientIdentifier || '',
        consenttype: consentType,
      },
    },
    update: {
      granted,
      createdat: new Date(),
    },
    create: {
      patientidentifier: patientIdentifier,
      userid: userId,
      consenttype: consentType,
      granted,
      createdat: new Date(),
    },
  });
  return consent;
}

module.exports = { recordConsent };