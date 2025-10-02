const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CONSENT_TYPE = 'DATA_SHARING';
const HEADER_GUEST_ID = 'x-guest-id';

const requireConsent = async (req, res, next) => {
  try {
    const userIdentifier = req.headers[HEADER_GUEST_ID];

    if (!userIdentifier) {
      return res.status(400).json({ error: 'MISSING_HEADER', message: 'userIdentifier is required for consent check' });
    }

    // Optional: Mask userIdentifier in logs
    console.info(`Checking consent for userIdentifier = ${userIdentifier.slice(0, 6)}***`);

    const consent = await prisma.userConsent.findFirst({
      where: {
        userIdentifier: { equals: userIdentifier, mode: 'insensitive' },
        consentType: CONSENT_TYPE,
        granted: true,
      },
    });

    if (!consent) {
      return res.status(403).json({ error: 'CONSENT_REQUIRED', message: 'User consent required for data sharing' });
    }

    next();
  } catch (error) {
    console.error('Consent check error:', error.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Server error' });
  }
};

module.exports = requireConsent;
