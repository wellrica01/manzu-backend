const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/medications', async (req, res) => {
  try {
    const medication = await prisma.medication.findFirst({
      select: { id: true, name: true, genericName: true, nafdacCode: true, imageUrl: true },
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
      select: { id: true, name: true },
      take: 10, // Limit results for performance
    });
    res.status(200).json(medications);
  } catch (error) {
    console.error('Error fetching medication suggestions:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch suggestions' });
  }
});

// Search endpoint with location-based filtering and sorting
router.get('/search', async (req, res) => {
  try {
    const { q, page = '1', limit = '10', lat, lng, radius = '10' } = req.query;
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ message: 'Search query is required' });
    }
    const searchTerm = `%${q.trim()}%`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const radiusKm = parseFloat(radius);

    let pharmacyFilter = {};
    let pharmacyIdsWithDistance = [];
    if (lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ message: 'Invalid latitude or longitude' });
      }
      // Fetch pharmacy IDs and distances within radius
      pharmacyIdsWithDistance = await prisma.$queryRaw`
        SELECT 
          id,
          ST_Distance(
            location,
            ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
          ) / 1000 AS distance_km
        FROM "Pharmacy"
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
          ${radiusKm} * 1000
        )
        ORDER BY distance_km
      `.then((results) => results.map((r) => ({ id: r.id, distance_km: r.distance_km })));

      const nearbyPharmacyIds = pharmacyIdsWithDistance.map((p) => p.id);
      pharmacyFilter = {
        pharmacy: {
          id: { in: nearbyPharmacyIds.length > 0 ? nearbyPharmacyIds : [-1] }, // Fallback
        },
      };
    }

    const medications = await prisma.medication.findMany({
      where: {
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { genericName: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      include: {
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

    const result = medications.map((med) => ({
      id: med.id,
      name: med.name,
      genericName: med.genericName,
      description: med.description,
      manufacturer: med.manufacturer,
      form: med.form,
      dosage: med.dosage,
      nafdacCode: med.nafdacCode,
      imageUrl: med.imageUrl,
      availability: med.pharmacyMedications
        .map((pm) => {
          const distanceEntry = pharmacyIdsWithDistance.find((p) => p.id === pm.pharmacyId);
          return {
            pharmacyId: pm.pharmacyId,
            pharmacyName: pm.pharmacy.name,
            stock: pm.stock,
            price: pm.price,
            receivedDate: pm.receivedDate,
            expiryDate: pm.expiryDate,
            distance_km: distanceEntry ? parseFloat(distanceEntry.distance_km.toFixed(2)) : null,
          };
        })
        .sort((a, b) => (a.distance_km || Infinity) - (b.distance_km || Infinity)), // Sort by distance
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('Error searching medications:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;