const { PrismaClient } = require('@prisma/client');
const { formatDisplayName } = require('../utils/medicationUtils'); 
const prisma = new PrismaClient();

async function getSampleMedication() {
  const medication = await prisma.medication.findFirst({
    select: { id: true, name: true, genericName: true, form: true, dosage: true, nafdacCode: true, imageUrl: true },
  });
  return {
    status: 'ok',
    database: 'connected',
    sampleMedication: medication || null,
  };
}

async function getMedicationSuggestions(searchTerm) {
  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }
  const normalizedTerm = `${searchTerm.trim()}%`;
  const medications = await prisma.medication.findMany({
    where: {
      OR: [
        { name: { startsWith: normalizedTerm, mode: 'insensitive' } },
        { genericName: { startsWith: normalizedTerm, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, dosage: true, form: true },
    take: 10,
  });
  return medications.map(med => ({
    id: med.id,
    displayName: formatDisplayName(med),
  }));
}

async function searchMedications({ q, medicationId, page, limit, lat, lng, radius, state, lga, ward, sortBy }) {
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;
  const radiusKm = parseFloat(radius);

  // Build pharmacy filter
  let pharmacyFilter = {
    pharmacy: {
      status: 'verified',
      isActive: true,
    },
    stock: { gt: 0 },
  };

  if (state) {
    pharmacyFilter.pharmacy.state = { equals: state, mode: 'insensitive' };
  }
  if (lga) {
    pharmacyFilter.pharmacy.lga = { equals: lga, mode: 'insensitive' };
  }
  if (ward) {
    pharmacyFilter.pharmacy.ward = { equals: ward, mode: 'insensitive' };
  }

  let pharmacyIdsWithDistance = [];
  let pharmacyCoordinates = new Map();
  
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (isNaN(latitude) || isNaN(longitude)) {
      throw new Error('Invalid latitude or longitude');
    }
    
    // Get pharmacies with distance and coordinates
    const pharmacyData = await prisma.$queryRaw`
      SELECT 
        id,
        ST_DistanceSphere(
          location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        ) / 1000 AS distance_km,
        ST_X(location) AS longitude,
        ST_Y(location) AS latitude
      FROM "Pharmacy"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
        ${radiusKm} * 1000
      )
      AND status = 'verified'
      AND "isActive" = true
      ORDER BY distance_km
    `;
    
    pharmacyIdsWithDistance = pharmacyData.map(r => ({ id: r.id, distance_km: r.distance_km }));
    pharmacyCoordinates = new Map(
      pharmacyData.map(r => [r.id, { latitude: r.latitude, longitude: r.longitude }])
    );

    const nearbyPharmacyIds = pharmacyIdsWithDistance.map(p => p.id);
    pharmacyFilter.pharmacy.id = { in: nearbyPharmacyIds.length > 0 ? nearbyPharmacyIds : [-1] };
  }

  // Build medication where clause
  let whereClause = {};
  if (medicationId) {
    whereClause = { id: parseInt(medicationId, 10) };
  } else if (q) {
    const query = q.trim();
    const nameMatch = query.match(/^([^0-9(]+)/)?.[1]?.trim() || query;
    const dosageMatch = query.match(/(\d+\w*)\s*\(/)?.[1]?.trim();
    const formMatch = query.match(/\((\w+)\)/)?.[1]?.trim();

    whereClause = {
      OR: [
        { name: { contains: `%${nameMatch}%`, mode: 'insensitive' } },
        { genericName: { contains: `%${nameMatch}%`, mode: 'insensitive' } },
      ],
    };
    if (dosageMatch) {
      whereClause.dosage = { equals: dosageMatch, mode: 'insensitive' };
    }
    if (formMatch) {
      whereClause.form = { equals: formMatch, mode: 'insensitive' };
    }
  }

  const medications = await prisma.medication.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      genericName: true,
      description: true,
      manufacturer: true,
      form: true,
      dosage: true,
      nafdacCode: true,
      imageUrl: true,
      pharmacyMedications: {
        where: pharmacyFilter,
        select: {
          stock: true,
          price: true,
          pharmacyId: true,
          receivedDate: true,
          expiryDate: true,
          pharmacy: { 
            select: { 
              name: true, 
              address: true,
              phone: true,
              licenseNumber: true,
              status: true,
              isActive: true,
              ward: true,
              lga: true,
              state: true,
              operatingHours: true
            } 
          },
        },
      },
    },
    take: limitNum,
    skip,
  });

  const distanceMap = new Map(
    pharmacyIdsWithDistance.map(entry => [entry.id, entry.distance_km])
  );

  const result = medications.map(med => {
    let availability = med.pharmacyMedications.map(pm => ({
      pharmacyId: pm.pharmacyId,
      pharmacyName: pm.pharmacy.name,
      address: pm.pharmacy.address,
      phone: pm.pharmacy.phone,
      licenseNumber: pm.pharmacy.licenseNumber,
      status: pm.pharmacy.status,
      isActive: pm.pharmacy.isActive,
      ward: pm.pharmacy.ward,
      lga: pm.pharmacy.lga,
      state: pm.pharmacy.state,
      operatingHours: pm.pharmacy.operatingHours,
      stock: pm.stock,
      price: pm.price,
      expiryDate: pm.expiryDate,
      distance_km: distanceMap.get(pm.pharmacyId) ? parseFloat(distanceMap.get(pm.pharmacyId).toFixed(2)) : null,
      // For now, we'll set coordinates to null since we can't easily extract them from the geometry
      // In a production environment, you might want to add a separate query to get coordinates
      latitude: pharmacyCoordinates.get(pm.pharmacyId)?.latitude || null,
      longitude: pharmacyCoordinates.get(pm.pharmacyId)?.longitude || null,
    }));

    // Sort availability
    if (sortBy === 'closest' && lat && lng) {
      availability = availability.sort((a, b) => (a.distance_km || Infinity) - (b.distance_km || Infinity));
    } else {
      availability = availability.sort((a, b) => a.price - b.price);
    }

    return {
      id: med.id,
      displayName: formatDisplayName(med),
      genericName: med.genericName,
      description: med.description,
      manufacturer: med.manufacturer,
      form: med.form,
      dosage: med.dosage,
      nafdacCode: med.nafdacCode,
      imageUrl: med.imageUrl,
      availability,
    };
  });

  return result;
}

module.exports = { getSampleMedication, getMedicationSuggestions, searchMedications };