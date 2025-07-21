const { PrismaClient } = require('@prisma/client');
const { formatDisplayName } = require('../utils/medicationUtils'); 
const prisma = new PrismaClient();

async function getSampleMedication() {
  const medication = await prisma.medication.findFirst({
    select: {
      id: true,
      brandName: true,
      form: true,
      strengthValue: true,
      strengthUnit: true,
      nafdacCode: true,
      imageUrl: true,
      genericMedication: { select: { name: true } },
      manufacturer: { select: { name: true } },
    },
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
  const normalizedTerm = searchTerm.trim();
  // Search by brandName and genericMedication.name
  const medications = await prisma.medication.findMany({
    where: {
      OR: [
        { brandName: { startsWith: normalizedTerm, mode: 'insensitive' } },
        { genericMedication: { name: { startsWith: normalizedTerm, mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true,
      brandName: true,
      form: true,
      strengthValue: true,
      strengthUnit: true,
      genericMedication: { select: { name: true } },
    },
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
      status: 'VERIFIED',
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
      AND status = 'VERIFIED'
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
    // Try to extract brand, generic, strength, form from query
    // e.g. "Panadol 500MG (TABLET)" or "Paracetamol"
    const brandMatch = query.match(/^([^0-9(]+)/)?.[1]?.trim() || query;
    const strengthMatch = query.match(/(\d+(?:\.\d+)?)(MG|ML|G|MCG|IU|NG|MMOL|PERCENT)?/i);
    const formMatch = query.match(/\((\w+)\)/)?.[1]?.trim();

    whereClause = {
      OR: [
        { brandName: { contains: brandMatch, mode: 'insensitive' } },
        { genericMedication: { name: { contains: brandMatch, mode: 'insensitive' } } },
      ],
    };
    if (strengthMatch && strengthMatch[1]) {
      whereClause.strengthValue = parseFloat(strengthMatch[1]);
      if (strengthMatch[2]) {
        whereClause.strengthUnit = strengthMatch[2].toUpperCase();
      }
    }
    if (formMatch) {
      whereClause.form = formMatch.toUpperCase();
    }
  }

  const medications = await prisma.medication.findMany({
    where: whereClause,
    select: {
      id: true,
      brandName: true,
      form: true,
      strengthValue: true,
      strengthUnit: true,
      nafdacCode: true,
      imageUrl: true,
      genericMedication: { select: { name: true } },
      manufacturer: { select: { name: true } },
      availabilities: {
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
    let availability = med.availabilities.map(av => ({
      pharmacyId: av.pharmacyId,
      pharmacyName: av.pharmacy.name,
      address: av.pharmacy.address,
      phone: av.pharmacy.phone,
      licenseNumber: av.pharmacy.licenseNumber,
      status: av.pharmacy.status,
      isActive: av.pharmacy.isActive,
      ward: av.pharmacy.ward,
      lga: av.pharmacy.lga,
      state: av.pharmacy.state,
      operatingHours: av.pharmacy.operatingHours,
      stock: av.stock,
      price: av.price,
      expiryDate: av.expiryDate,
      distance_km: distanceMap.get(av.pharmacyId) ? parseFloat(distanceMap.get(av.pharmacyId).toFixed(2)) : null,
      latitude: pharmacyCoordinates.get(av.pharmacyId)?.latitude || null,
      longitude: pharmacyCoordinates.get(av.pharmacyId)?.longitude || null,
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
      genericName: med.genericMedication?.name || null,
      manufacturer: med.manufacturer?.name || null,
      form: med.form,
      strengthValue: med.strengthValue,
      strengthUnit: med.strengthUnit,
      nafdacCode: med.nafdacCode,
      imageUrl: med.imageUrl,
      availability,
    };
  });

  return result;
}

module.exports = { getSampleMedication, getMedicationSuggestions, searchMedications };