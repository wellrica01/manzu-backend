/**
 * CONSENT SERVICE
 * 
 * Business logic for user consent management
 * Refactored to use repository pattern
 */

const consentRepository = require('./consent.repository');

/**
 * Record user consent
 * 
 * @param {Object} params - Consent parameters
 * @param {string} [params.userIdentifier] - Guest user identifier
 * @param {number} [params.userId] - Pharmacy user ID
 * @param {string} params.consentType - Type of consent
 * @param {boolean} params.granted - Whether consent was granted
 * @returns {Promise<Object>} Consent record
 * @throws {Error} If neither userIdentifier nor userId provided
 */
async function recordConsent({ userIdentifier, userId, consentType, granted }) {
  // Validate input
  if (!userIdentifier && !userId) {
    throw new Error('Either userIdentifier or userId must be provided.');
  }

  // Record consent based on user type
  if (userIdentifier) {
    return await consentRepository.upsertUserConsent(userIdentifier, consentType, granted);
  } else {
    return await consentRepository.upsertPharmacyUserConsent(userId, consentType, granted);
  }
}

module.exports = {
  recordConsent,
};