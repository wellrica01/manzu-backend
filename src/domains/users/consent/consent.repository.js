/**
 * CONSENT REPOSITORY
 * 
 * Database access layer for user consent management
 */

const prisma = require('../../../core/database/prisma');

/**
 * Upsert user consent (guest users)
 * 
 * @param {string} userIdentifier - Guest user identifier
 * @param {string} consentType - Type of consent
 * @param {boolean} granted - Whether consent was granted
 * @returns {Promise<Object>} Consent record
 */
async function upsertUserConsent(userIdentifier, consentType, granted) {
  return await prisma.userConsent.upsert({
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
}

/**
 * Upsert pharmacy user consent (authenticated users)
 * 
 * @param {number} userId - Pharmacy user ID
 * @param {string} consentType - Type of consent
 * @param {boolean} granted - Whether consent was granted
 * @returns {Promise<Object>} Consent record
 */
async function upsertPharmacyUserConsent(userId, consentType, granted) {
  return await prisma.pharmacyUserConsent.upsert({
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
}

module.exports = {
  upsertUserConsent,
  upsertPharmacyUserConsent,
};