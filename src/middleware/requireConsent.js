const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const requireConsent = async (req, res, next) => {
  try {
    const userIdentifier = req.headers['x-guest-id'];

    if (!userIdentifier) {
      return res.status(400).json({ message: 'userIdentifier is required for consent check' });
    }

    console.log('Checking consent for userIdentifier =', userIdentifier);

    const consent = await prisma.patientConsent.findFirst({
      where: {
        userIdentifier: {
          equals: userIdentifier,
          mode: 'insensitive',
        },
        consentType: 'DATA_SHARING', // Update to match your required consent type
        granted: true,
      },
    });

    console.log('Consent found:', consent);

    if (!consent) {
      return res.status(403).json({ message: 'User consent required for data sharing' });
    }

    next();
  } catch (error) {
    console.error('Consent check error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = requireConsent;