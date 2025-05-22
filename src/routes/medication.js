const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/medications', async (req, res) => {
  try {
    const medication = await prisma.medication.findFirst({
      select: { id: true, name: true, genericName: true, form: true, dosage: true, nafdacCode: true, imageUrl: true },
    });
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      sampleMedication: medication || null,
    });
  } catch (error) {
    console.error('Error fetching medication:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch medication data' });
  }
});
 

// Lightweight endpoint for autocomplete suggestions
router.get('/medication-suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) {
      return res.status(200).json([]);
    }
    const searchTerm = `${q.trim()}%`; // Use startsWith for autocomplete
    const medications = await prisma.medication.findMany({
      where: {
        OR: [
          { name: { startsWith: searchTerm, mode: 'insensitive' } },
          { genericName: { startsWith: searchTerm, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, dosage: true, form: true, },
      take: 10, // Limit results for performance
    });
     // Format displayName as "name dosage (form)"
    const formattedMedications = medications.map((med) => ({
      id: med.id,
      displayName: `${med.name}${med.dosage ? ` ${med.dosage}` : ''}${med.form ? ` (${med.form})` : ''}`,
    }));
    res.status(200).json(formattedMedications);
  } catch (error) {
    console.error('Error fetching medication suggestions:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch suggestions' });
  }
});

// Search endpoint with weighted scoring
router.get('/search', async (req, res) => {
  try {
    const { q, medicationId, page = '1', limit = '10', lat, lng, radius = '10' } = req.query;
    if (!q && !medicationId) {
      return res.status(400).json({ message: 'Search query or medication ID is required' });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const radiusKm = parseFloat(radius);

    let pharmacyFilter = {
      pharmacy: {
        status: 'verified',
        isActive: true,
      },
      stock: { gt: 0 },
    };
    let pharmacyIdsWithDistance = [];
    if (lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ message: 'Invalid latitude or longitude' });
      }
      pharmacyIdsWithDistance = await prisma.$queryRaw`
        SELECT 
          id,
          ST_DistanceSphere(
            location,
            ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
          ) / 1000 AS distance_km
        FROM "Pharmacy"
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
          ${radiusKm} * 1000
        )
        AND status = 'verified'
        AND "isActive" = true
        ORDER BY distance_km
      `.then((results) => results.map((r) => ({ id: r.id, distance_km: r.distance_km })));

      const nearbyPharmacyIds = pharmacyIdsWithDistance.map((p) => p.id);
      pharmacyFilter.pharmacy.id = { in: nearbyPharmacyIds.length > 0 ? nearbyPharmacyIds : [-1] };
    }

    let whereClause = {};
    if (medicationId) {
      // Precise query by ID for dropdown selections
      whereClause = { id: parseInt(medicationId, 10) };
    } else if (q) {
      // Text query for manual searches
      const query = q.trim();
      // Extract name, dosage, and form (if present)
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
            pharmacy: { select: { name: true } },
          },
        },
      },
      take: limitNum,
      skip,
    });

const distanceMap = new Map(
  pharmacyIdsWithDistance.map((entry) => [entry.id, entry.distance_km])
);

const result = medications.map((med) => {
  const prices = med.pharmacyMedications.map((pm) => pm.price);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const priceRange = maxPrice - minPrice || 1;

  const distances = med.pharmacyMedications.map((pm) => {
    const d = distanceMap.get(pm.pharmacyId) ?? radiusKm;
    return d;
  });
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const distanceRange = maxDistance - minDistance || 1;

  const availability = med.pharmacyMedications
    .map((pm) => {
      const distance_km = distanceMap.get(pm.pharmacyId) ?? radiusKm;

      const normalizedPrice = (pm.price - minPrice) / priceRange;
      const normalizedDistance = (distance_km - minDistance) / distanceRange;

      const score = (0.6 * normalizedPrice) + (0.4 * normalizedDistance);

      return {
        pharmacyId: pm.pharmacyId,
        pharmacyName: pm.pharmacy.name,
        address: pm.pharmacy.address,
        stock: pm.stock,
        price: pm.price,
        expiryDate: pm.expiryDate,
        distance_km: parseFloat(distance_km.toFixed(2)),
        score: parseFloat(score.toFixed(3)),
      };
    })
    .sort((a, b) => a.score - b.score);

  return {
    id: med.id,
    displayName: `${med.name}${med.dosage ? ` ${med.dosage}` : ''}${med.form ? ` (${med.form})` : ''}`,
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

    res.status(200).json(result);
  } catch (error) {
    console.error('Error searching medications:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;