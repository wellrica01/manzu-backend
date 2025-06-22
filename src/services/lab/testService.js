const { PrismaClient } = require('@prisma/client');
const { formatDisplayName } = require('../../utils/lab/testUtils');
const prisma = new PrismaClient();

async function getSampleTest() {
  const test = await prisma.test.findFirst({
    select: { id: true, name: true, testType: true, testCode: true, imageUrl: true },
  });
  return {
    status: 'ok',
    database: 'connected',
    sampleTest: test || null,
  };
}

async function getTestSuggestions(searchTerm) {
  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }
  const normalizedTerm = `${searchTerm.trim()}%`;
  const tests = await prisma.test.findMany({
    where: {
      OR: [
        { name: { startsWith: normalizedTerm, mode: 'insensitive' } },
        { testType: { startsWith: normalizedTerm, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true },
    take: 10,
  });
  return tests.map(test => ({
    id: test.id,
    displayName: formatDisplayName(test),
  }));
}

async function searchTests({ q, testId, page, limit, lat, lng, radius, state, lga, ward, sortBy }) {
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;
  const radiusKm = parseFloat(radius);

  // Build lab filter
  let labFilter = {
    Lab: { // Fixed: Changed 'lab' to 'Lab'
      status: 'verified',
      isActive: true,
    },
    available: true,
  };

  if (state) {
    labFilter.Lab.state = { equals: state, mode: 'insensitive' };
  }
  if (lga) {
    labFilter.Lab.lga = { equals: lga, mode: 'insensitive' };
  }
  if (ward) {
    labFilter.Lab.ward = { equals: ward, mode: 'insensitive' };
  }

  let labIdsWithDistance = [];
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (isNaN(latitude) || isNaN(longitude)) {
      throw new Error('Invalid latitude or longitude');
    }
    labIdsWithDistance = await prisma.$queryRaw`
      SELECT 
        id,
        ST_DistanceSphere(
          location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        ) / 1000 AS distance_km
      FROM "Lab"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
        ${radiusKm} * 1000
      )
      AND status = 'verified'
      AND "isActive" = true
      ORDER BY distance_km
    `.then(results => results.map(r => ({ id: r.id, distance_km: r.distance_km })));

    const nearbyLabIds = labIdsWithDistance.map(l => l.id);
    labFilter.Lab.id = { in: nearbyLabIds.length > 0 ? nearbyLabIds : [-1] };
  }

  // Build test where clause
  let whereClause = {};
  if (testId) {
    whereClause = { id: parseInt(testId, 10) };
  } else if (q) {
    const query = q.trim();
    whereClause = {
      OR: [
        { name: { contains: `%${query}%`, mode: 'insensitive' } },
        { testType: { contains: `%${query}%`, mode: 'insensitive' } },
      ],
    };
  }

  const tests = await prisma.test.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      testType: true,
      description: true,
      testCode: true,
      imageUrl: true,
      LabTest: {
        where: labFilter,
        select: {
          price: true,
          labId: true,
          createdAt: true,
          updatedAt: true,
          Lab: {
            select: {
              name: true,
              address: true,
            },
          },
        },
      },
    },
    take: limitNum,
    skip,
  });

  const distanceMap = new Map(
    labIdsWithDistance.map(entry => [entry.id, entry.distance_km])
  );

  const result = tests.map(test => {
    let availability = test.LabTest.map(lt => ({
      labId: lt.labId,
      labName: lt.Lab.name,
      address: lt.Lab.address,
      price: lt.price,
      distance_km: distanceMap.get(lt.labId) ? parseFloat(distanceMap.get(lt.labId).toFixed(2)) : null,
    }));

    // Sort availability
    if (sortBy === 'closest' && lat && lng) {
      availability = availability.sort((a, b) => (a.distance_km || Infinity) - (b.distance_km || Infinity));
    } else {
      availability = availability.sort((a, b) => a.price - b.price);
    }

    return {
      id: test.id,
      displayName: formatDisplayName(test),
      testType: test.testType,
      description: test.description,
      testCode: test.testCode,
      imageUrl: test.imageUrl,
      availability,
    };
  });

  return result;
}

module.exports = { getSampleTest, getTestSuggestions, searchTests };