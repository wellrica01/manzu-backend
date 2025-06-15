const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const requireConsent = async (req, res, next) => {
  try {
    const patientIdentifier = req.headers['x-guest-id'];

    if (!patientIdentifier) {
      return res.status(400).json({ message: 'patientIdentifier is required for consent check' });
    }

    console.log('Checking consent for patientIdentifier =', patientIdentifier);

    const consent = await prisma.consent.findFirst({
      where: {
        patientidentifier: {
          equals: patientIdentifier,
          mode: 'insensitive',
        },
        consenttype: 'data_collection',
        granted: true,
      },
    });

    console.log('Consent found:', consent);

    if (!consent) {
      return res.status(403).json({ message: 'User consent required for data collection' });
    }

    next();
  } catch (error) {
    console.error('Consent check error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = requireConsent;