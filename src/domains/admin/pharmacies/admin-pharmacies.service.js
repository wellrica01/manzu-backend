/**
 * ADMIN PHARMACIES SERVICE
 * 
 * Business logic for admin pharmacy management
 */

const pharmaciesRepository = require('./admin-pharmacies.repository');
const { HTTP_STATUS, ERROR_CODES } = require('../../../config/constants');

/**
 * Get pharmacies with filters and pagination
 */
async function getPharmacies({ page = 1, limit = 10, status, state, name }) {
  const skip = (page - 1) * limit;
  const where = {};
  
  if (status && status !== "all") where.status = status.toUpperCase();
  if (state) where.state = state;
  if (name) where.name = { contains: name, mode: "insensitive" };

  const [pharmacies, total] = await pharmaciesRepository.findPharmacies({
    skip,
    limit,
    where,
  });

  return {
    pharmacies,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get simple list of all pharmacies (for filters)
 */
async function getSimplePharmacies() {
  const simplePharmacies = await pharmaciesRepository.findAllPharmaciesSimple();
  console.log('Pharmacies fetched for filter:', { count: simplePharmacies.length });
  return simplePharmacies;
}

/**
 * Get single pharmacy by ID
 */
async function getPharmacy(id) {
  const pharmacy = await pharmaciesRepository.findPharmacyById(id);
  
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  
  console.log('Pharmacy fetched:', { pharmacyId: id });
  return pharmacy;
}

/**
 * Update pharmacy
 */
async function updatePharmacy(id, data) {
  // Check if pharmacy exists
  const existingPharmacy = await pharmaciesRepository.findPharmacyById(id);
  if (!existingPharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  // Check for license number conflict
  if (data.licenseNumber && data.licenseNumber !== existingPharmacy.licenseNumber) {
    const licenseConflict = await pharmaciesRepository.findPharmacyByLicense(data.licenseNumber);
    if (licenseConflict) {
      const error = new Error('License number already exists');
      error.status = HTTP_STATUS.BAD_REQUEST;
      error.code = ERROR_CODES.VALIDATION_ERROR;
      throw error;
    }
  }

  // Build update payload
  const updateData = {
    name: data.name,
    address: data.address,
    lga: data.lga,
    state: data.state,
    phone: data.phone,
    licenseNumber: data.licenseNumber,
    status: data.status,
    logoUrl: data.logoUrl,
    isActive: data.isActive,
    verifiedAt:
      data.status === 'VERIFIED'
        ? new Date()
        : data.status === 'REJECTED'
        ? null
        : existingPharmacy.verifiedAt,
  };

  // Include lat/long if provided
  if (typeof data.lat === 'number' && typeof data.long === 'number') {
    updateData.lat = data.lat;
    updateData.long = data.long;
  }

  // Run atomic transaction
  const updatedPharmacy = await pharmaciesRepository.executeTransaction(async (tx) => {
    const pharmacy = await tx.pharmacy.update({
      where: { id },
      data: updateData,
    });

    // If coordinates provided, also sync PostGIS location
    if (typeof data.lat === 'number' && typeof data.long === 'number') {
      await pharmaciesRepository.updatePharmacyLocation(id, data.lat, data.long, tx);
    }

    return pharmacy;
  });

  // Return formatted response
  console.log('Pharmacy updated:', { pharmacyId: id });
  return {
    id: updatedPharmacy.id,
    name: updatedPharmacy.name,
    address: updatedPharmacy.address,
    lga: updatedPharmacy.lga,
    state: updatedPharmacy.state,
    phone: updatedPharmacy.phone,
    licenseNumber: updatedPharmacy.licenseNumber,
    status: updatedPharmacy.status,
    logoUrl: updatedPharmacy.logoUrl,
    isActive: updatedPharmacy.isActive,
    lat: updatedPharmacy.lat,
    long: updatedPharmacy.long,
    createdAt: updatedPharmacy.createdAt,
    verifiedAt: updatedPharmacy.verifiedAt,
  };
}

/**
 * Delete pharmacy
 */
async function deletePharmacy(id) {
  const existingPharmacy = await pharmaciesRepository.findPharmacyById(id);
  if (!existingPharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = HTTP_STATUS.NOT_FOUND;
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }
  
  await pharmaciesRepository.deletePharmacy(id);
  console.log('Pharmacy deleted:', { pharmacyId: id });
}

module.exports = {
  getPharmacies,
  getSimplePharmacies,
  getPharmacy,
  updatePharmacy,
  deletePharmacy,
};