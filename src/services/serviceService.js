const { PrismaClient } = require('@prisma/client');
const { formatServiceDisplayName } = require('../utils/serviceUtils.js');
const prisma = new PrismaClient();

async function getSampleService(type) {
  const where = type ? { type } : {};
  const service = await prisma.service.findFirst({
    where,
    select: {
      id: true,
      type: true,
      name: true,
      genericName: true,
      form: true,
      dosage: true,
      nafdacCode: true,
      testType: true,
      testCode: true,
      prepInstructions: true,
      imageUrl: true,
    },
  });
  return {
    status: 'ok',
    database: 'connected',
    sampleService: service || null,
  };
}

async function getServiceSuggestions(searchTerm, type) {
  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }
  const normalizedTerm = `${searchTerm.trim()}%`;
  const where = {
    OR: [
      { name: { startsWith: normalizedTerm, mode: 'insensitive' } },
      { genericName: { startsWith: normalizedTerm, mode: 'insensitive' } },
      { testType: { startsWith: normalizedTerm, mode: 'insensitive' } },
    ],
    ...(type && { type }),
  };
  const services = await prisma.service.findMany({
    where,
    select: { id: true, name: true, type: true, dosage: true, form: true, testType: true },
    take: 10,
  });
  return services.map(service => ({
    id: service.id,
    displayName: formatServiceDisplayName(service),
  }));
}

async function searchServices({ q, serviceId, page, limit, lat, lng, radius, state, lga, ward, sortBy, homeCollection, type }) {
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;
  const radiusKm = parseFloat(radius) || 10;

  // Build provider filter
  let providerFilter = {
    provider: {
      status: 'verified',
      isActive: true,
    },
    ...(type === 'medication' ? { stock: { gt: 0 } } : { available: true }),
  };

  if (state) {
    providerFilter.provider.state = { equals: state, mode: 'insensitive' };
  }
  if (lga) {
    providerFilter.provider.lga = { equals: lga, mode: 'insensitive' };
  }
  if (ward) {
    providerFilter.provider.ward = { equals: ward, mode: 'insensitive' };
  }
  if (homeCollection === 'true') {
    providerFilter.provider.homeCollectionAvailable = true;
  }

  let providerIdsWithDistance = [];
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error('Invalid latitude or longitude');
    }
    providerIdsWithDistance = await prisma.$queryRaw`
      SELECT 
        id,
        ST_DistanceSphere(
          location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        ) / 1000 AS distance_km
      FROM "Provider"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
        ${radiusKm} * 1000
      )
      AND status = 'verified'
      AND "isActive" = true
      ORDER BY distance_km
    `.then(results => results.map(r => ({ id: r.id, distance_km: r.distance_km })));

    const nearbyProviderIds = providerIdsWithDistance.map(p => p.id);
    providerFilter.provider.id = { in: nearbyProviderIds.length > 0 ? nearbyProviderIds : [-1] };
  }

  // Build service where clause
  let whereClause = {};
  if (serviceId) {
    whereClause = { id: parseInt(serviceId, 10) };
  } else if (q) {
    const query = q.trim();
    const nameMatch = query.match(/^([^0-9(]+)/)?.[1]?.trim() || query;
    const dosageMatch = query.match(/(\d+\w*)\s*\(/)?.[1]?.trim();
    const formMatch = query.match(/\((\w+)\)/)?.[1]?.trim();

    whereClause = {
      OR: [
        { name: { contains: nameMatch, mode: 'insensitive' } },
        { genericName: { contains: nameMatch, mode: 'insensitive' } },
        { testType: { contains: nameMatch, mode: 'insensitive' } },
      ],
    };
    if (dosageMatch) {
      whereClause.dosage = { equals: dosageMatch, mode: 'insensitive' };
    }
    if (formMatch) {
      whereClause.form = { equals: formMatch, mode: 'insensitive' };
    }
    if (type) {
      whereClause.type = type;
    }
  } else if (type) {
    whereClause.type = type;
  }

  const services = await prisma.service.findMany({
    where: whereClause,
    select: {
      id: true,
      type: true,
      name: true,
      genericName: true,
      description: true,
      manufacturer: true,
      form: true,
      dosage: true,
      nafdacCode: true,
      testType: true,
      testCode: true,
      prepInstructions: true,
      prescriptionRequired: true,
      imageUrl: true,
      providerServices: {
        where: providerFilter,
        select: {
          stock: true,
          price: true,
          providerId: true,
          receivedDate: true,
          expiryDate: true,
          resultTurnaroundHours: true,
          provider: { select: { name: true, address: true, homeCollectionAvailable: true } },
        },
      },
    },
    take: limitNum,
    skip,
  });

  const distanceMap = new Map(
    providerIdsWithDistance.map(entry => [entry.id, entry.distance_km])
  );

  const result = services.map(service => {
    let availability = service.providerServices.map(ps => ({
      providerId: ps.providerId,
      providerName: ps.provider.name,
      address: ps.provider.address,
      stock: ps.stock,
      price: ps.price,
      expiryDate: ps.expiryDate,
      resultTurnaroundHours: ps.resultTurnaroundHours,
      homeCollectionAvailable: ps.provider.homeCollectionAvailable,
      distance_km: distanceMap.get(ps.providerId) ? parseFloat(distanceMap.get(ps.providerId).toFixed(2)) : null,
    }));

    // Sort availability
    if (sortBy === 'closest' && lat && lng) {
      availability = availability.sort((a, b) => (a.distance_km || Infinity) - (b.distance_km || Infinity));
    } else {
      availability = availability.sort((a, b) => a.price - b.price);
    }

    return {
      id: service.id,
      type: service.type,
      displayName: formatServiceDisplayName(service),
      genericName: service.genericName,
      description: service.description,
      manufacturer: service.manufacturer,
      form: service.form,
      dosage: service.dosage,
      nafdacCode: service.nafdacCode,
      testType: service.testType,
      testCode: service.testCode,
      prepInstructions: service.prepInstructions,
      prescriptionRequired: service.prescriptionRequired,
      imageUrl: service.imageUrl,
      availability,
    };
  });

  return result;
}

module.exports = { getSampleService, getServiceSuggestions, searchServices };