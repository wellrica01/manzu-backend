/**
 * PHARMACY USERS SERVICE
 * 
 * Business logic for pharmacy users/staff operations
 */

const repository = require('./pharmacy-users.repository');

/**
 * Fetch all users for a pharmacy
 */
async function fetchUsers(pharmacyId) {
  const users = await repository.findPharmacyUsers(pharmacyId);
  console.log('Users fetched:', { pharmacyId, userCount: users.length });
  return users;
}

module.exports = {
  fetchUsers,
};