const { PrismaClient, DosageForm } = require('@prisma/client');
const { capitalize, formatPackSizeUnit, formatPerUnitType, formatStrengthUnit } = require('../utils/medicationUtils')

const prisma = new PrismaClient();

/**
 * Helper to map ingredients to a clean array of { activeSubstance, strengthValue, strengthUnit }
 */
function mapIngredients(medication) {
  return medication.Medication_MedicationIngredient.map(mmi => {
    const ingredient = mmi.MedicationIngredient;
    return {
      activeSubstance: ingredient.ActiveSubstance?.name || null,
      strengthValue: ingredient.strengthValue || null,
      strengthUnit: ingredient.strengthUnit || null,
    };
  });
}

/**
 * Fetch a single sample medication with all ingredients.
 */
async function getSampleMedication() {
  const medication = await prisma.medication.findFirst({
    select: {
      id: true,
      brandName: true,
      form: true,
      nafdacCode: true,
      imageUrl: true,
      Manufacturer: { select: { name: true } },
      Medication_MedicationIngredient: {
        select: {
          MedicationIngredient: {
            select: {
              strengthValue: true,
              strengthUnit: true,
              ActiveSubstance: { select: { name: true } }
            }
          }
        }
      }
    }
  });

  return {
    status: 'ok',
    database: 'connected',
    sampleMedication: medication
      ? {
          id: medication.id,
          brandName: medication.brandName,
          form: medication.form,
          nafdacCode: medication.nafdacCode,
          imageUrl: medication.imageUrl,
          manufacturerName: medication.Manufacturer?.name || null,
          ingredients: mapIngredients(medication),
        }
      : null,
  };
}

/**
 * Suggest medications by brand name, full name, or active substance (all ingredients included)
 */
async function getMedicationSuggestions(searchTerm) {
  if (!searchTerm || searchTerm.trim().length === 0) return [];

  const normalizedTerm = searchTerm.trim();
  // Replace spaces with underscores for enum matching
  const enumFormat = normalizedTerm.toUpperCase().replace(/\s+/g, '_');

  const medications = await prisma.$queryRaw`
    SELECT DISTINCT 
      m.id, 
      m."brandName", 
      m.form, 
      m."packSizeExpression", 
      m."packSizeUnit", 
      m.pharmacopeia, 
      m."imageUrl",
      GREATEST(
        similarity(m."brandName", ${normalizedTerm}),
        COALESCE(MAX(similarity(a.name, ${normalizedTerm})), 0),
        CASE 
          WHEN m.form IS NOT NULL THEN 
            GREATEST(
              similarity(REPLACE(m.form::text, '_', ' '), ${normalizedTerm}),
              similarity(m.form::text, ${enumFormat})
            )
          ELSE 0
        END
      ) as rank
    FROM "Medication" m
    LEFT JOIN "Medication_MedicationIngredient" mmi ON m.id = mmi."medicationId"
    LEFT JOIN "MedicationIngredient" mi ON mmi."ingredientId" = mi.id
    LEFT JOIN "ActiveSubstance" a ON mi."substanceId" = a.id
    WHERE 
      m."brandName" ILIKE ${`%${normalizedTerm}%`}
      OR a.name ILIKE ${`%${normalizedTerm}%`}
      OR REPLACE(m.form::text, '_', ' ') ILIKE ${`%${normalizedTerm}%`}
      OR m.form::text ILIKE ${`%${enumFormat}%`}
    GROUP BY m.id, m."brandName", m.form, m."packSizeExpression", 
             m."packSizeUnit", m.pharmacopeia, m."imageUrl"
    ORDER BY rank DESC, m."brandName" ASC
    LIMIT 10
  `;

  if (medications.length === 0) return [];

  // Rest of your code remains the same...
  const medIds = medications.map(m => m.id);
  
  const fullMedications = await prisma.medication.findMany({
    where: { id: { in: medIds } },
    select: {
      id: true,
      brandName: true,
      form: true,
      packSizeExpression: true,
      packSizeUnit: true,
      pharmacopeia: true,
      imageUrl: true,
      Medication_MedicationIngredient: {
        select: {
          MedicationIngredient: {
            select: {
              strengthValue: true,
              strengthUnit: true,
              ActiveSubstance: { select: { name: true } }
            }
          }
        }
      }
    }
  });

  const medMap = new Map(fullMedications.map(m => [m.id, m]));
  
  return medications
    .map(m => medMap.get(m.id))
    .filter(Boolean)
    .map(med => ({
      id: med.id,
      brandName: med.brandName,
      displayName: med.form
        ? `${med.brandName}${med.pharmacopeia ? ` ${med.pharmacopeia}` : ''} (${capitalize(med.form)})`
        : med.brandName,
      form: med.form,
      packSizeExpression: med.packSizeExpression,
      packSizeUnit: formatPackSizeUnit(med.packSizeUnit),
      imageUrl: med.imageUrl,
      ingredients: med.Medication_MedicationIngredient.map(mmi => ({
        activeSubstance: mmi.MedicationIngredient.ActiveSubstance?.name,
        strengthValue: mmi.MedicationIngredient.strengthValue,
        strengthUnit: formatStrengthUnit(mmi.MedicationIngredient.strengthUnit),
      })),
    }));
}

/**
 * Search medications with pharmacy availability, stock, optional distance, and include all ingredients.
 */
async function searchMedications({ q, medicationId, page = 1, limit = 20, lat, lng, radius = 10, state, lga, sortBy = 'cheapest' }) {
  const skip = (page - 1) * limit;
  const radiusKm = parseFloat(radius) || 10; // Default 10km

  // Check if any location filters are provided
  const hasLocationFilters = lat || lng || state || lga;

  // Base pharmacy filter (always applied)
  let pharmacyFilter = { 
    Pharmacy: { 
      status: 'VERIFIED', 
      isActive: true 
    }, 
    stock: { gt: 0 } 
  };

  // Add state/lga filters if provided
  if (state) pharmacyFilter.Pharmacy.state = { equals: state, mode: 'insensitive' };
  if (lga) pharmacyFilter.Pharmacy.lga = { equals: lga, mode: 'insensitive' };

  // Calculate distances if user location provided
  let pharmacyIdsWithDistance = [];
  let distanceMap = new Map();
  
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    
    if (isNaN(latitude) || isNaN(longitude)) {
      throw new Error('Invalid latitude or longitude');
    }

    // Validate coordinates are in Nigeria
    if (latitude < 4 || latitude > 14 || longitude < 3 || longitude > 15) {
      throw new Error('Coordinates must be within Nigeria');
    }

    // Query pharmacies within radius using PostGIS
    const pharmacyData = await prisma.$queryRaw`
      SELECT 
        id,
        latitude,
        longitude,
        ST_DistanceSphere(
          location, 
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        ) / 1000 AS distance_km
      FROM "Pharmacy"
      WHERE 
        ST_DWithin(
          location, 
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326), 
          ${radiusKm * 1000}
        )
        AND status = 'VERIFIED'
        AND "isActive" = true
      ORDER BY distance_km ASC
    `;

    // Build maps for efficient lookup
    pharmacyIdsWithDistance = pharmacyData.map(r => r.id);
    distanceMap = new Map(
      pharmacyData.map(r => [
        r.id, 
        {
          distance_km: parseFloat(r.distance_km.toFixed(2)),
          latitude: parseFloat(r.latitude),
          longitude: parseFloat(r.longitude)
        }
      ])
    );

    // Filter to only nearby pharmacies if user location provided
    if (pharmacyIdsWithDistance.length > 0) {
      pharmacyFilter.Pharmacy.id = { in: pharmacyIdsWithDistance };
    } else {
      // No pharmacies found within radius
      pharmacyFilter.Pharmacy.id = { in: [-1] }; // No results
    }
  }

  // Build medication where clause
  let whereClause = {};
  if (medicationId) {
    whereClause.id = parseInt(medicationId, 10);
  } else if (q) {
    const query = q.trim();
    const brandMatch = query.match(/^([^0-9(]+)/)?.[1]?.trim() || query;
    const strengthMatch = query.match(/(\d+(?:\.\d+)?)(MG|ML|G|MCG|IU|NG|MMOL|PERCENT)?/i);
    const formMatch = query.match(/\((\w+)\)/)?.[1]?.trim();

    whereClause.OR = [
      { brandName: { contains: brandMatch, mode: 'insensitive' } },
      {
        Medication_MedicationIngredient: {
          some: {
            MedicationIngredient: { 
              ActiveSubstance: { 
                name: { contains: brandMatch, mode: 'insensitive' } 
              } 
            }
          }
        }
      }
    ];

    if (strengthMatch && strengthMatch[1]) {
      const value = parseFloat(strengthMatch[1]);
      whereClause.Medication_MedicationIngredient = {
        some: { 
          MedicationIngredient: { 
            strengthValue: value,
            ...(strengthMatch[2] && { strengthUnit: strengthMatch[2].toUpperCase() })
          } 
        }
      };
    }

    if (formMatch) {
      const formEnum = formMatch.toUpperCase();
      if (Object.values(DosageForm).includes(formEnum)) {
        whereClause.form = formEnum;
      }
    }
  }

  // Build select clause
  const selectClause = {
    id: true,
    brandName: true,
    form: true,
    packSizeExpression: true,
    packSizeUnit: true,
    prescriptionRequired: true,
    nafdacCode: true,
    pharmacopeia: true,
    imageUrl: true,
    Manufacturer: { 
      select: { name: true, country: true } 
    },
    Medication_MedicationIngredient: {
      select: {
        MedicationIngredient: {
          select: {
            strengthValue: true,
            strengthUnit: true,
            ActiveSubstance: { select: { name: true } }
          }
        }
      }
    }
  };

  // Only include MedicationAvailability if location filters are present
  if (hasLocationFilters) {
    selectClause.MedicationAvailability = {
      where: pharmacyFilter,
      select: {
        stock: true,
        price: true,
        pharmacyId: true,
        receivedDate: true,
        expiryDate: true,
        Pharmacy: {
          select: {
            id: true,
            name: true,
            address: true,
            logoUrl: true,
            phone: true,
            licenseNumber: true,
            status: true,
            isActive: true,
            latitude: true,  // NEW: Direct from column
            longitude: true, // NEW: Direct from column
            lga: true,
            state: true,
            OperatingHour: { 
              select: { 
                dayOfWeek: true, 
                openTime: true, 
                closeTime: true 
              } 
            }
          }
        }
      }
    };
  }

  // Fetch medications
  const medications = await prisma.medication.findMany({
    where: whereClause,
    select: selectClause,
    take: Number(limit) || 20,
    skip: Number(skip) || 0,
  });

  // Map and format results
  return medications.map(med => {
    // Format ingredients
    const ingredients = med.Medication_MedicationIngredient.map(mmi => {
      const ingredient = mmi.MedicationIngredient;
      return {
        activeSubstance: ingredient.ActiveSubstance?.name || null,
        strengthValue: ingredient.strengthValue || null,
        strengthUnit: formatStrengthUnit(ingredient.strengthUnit),
        perUnitValue: ingredient.perUnitValue || null,
        perUnitType: formatPerUnitType(ingredient.perUnitType),
      };
    });

    // Map availability with distances
    let availability = [];
    if (hasLocationFilters && med.MedicationAvailability) {
      availability = med.MedicationAvailability.map(av => {
        const distanceData = distanceMap.get(av.pharmacyId);
        
        return {
          pharmacyId: av.pharmacyId,
          pharmacyName: av.Pharmacy.name,
          logoUrl: av.Pharmacy.logoUrl,
          address: av.Pharmacy.address,
          phone: av.Pharmacy.phone,
          licenseNumber: av.Pharmacy.licenseNumber,
          status: av.Pharmacy.status,
          isActive: av.Pharmacy.isActive,
          lga: av.Pharmacy.lga,
          state: av.Pharmacy.state,
          operatingHours: av.Pharmacy.OperatingHour.map(h => ({
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime instanceof Date 
              ? h.openTime.toISOString().slice(11, 16) 
              : h.openTime,
            closeTime: h.closeTime instanceof Date 
              ? h.closeTime.toISOString().slice(11, 16) 
              : h.closeTime
          })),
          stock: av.stock,
          price: parseFloat(av.price),
          expiryDate: av.expiryDate,
          // Distance data (from distanceMap or fallback to pharmacy columns)
          distance_km: distanceData?.distance_km || null,
          distance_meters: distanceData?.distance_km 
            ? Math.round(distanceData.distance_km * 1000) 
            : null,
          distance_display: distanceData?.distance_km
            ? (distanceData.distance_km < 1 
                ? `${Math.round(distanceData.distance_km * 1000)}m away`
                : `${distanceData.distance_km.toFixed(1)}km away`)
            : null,
          latitude: parseFloat(av.Pharmacy.latitude) || null,
          longitude: parseFloat(av.Pharmacy.longitude) || null,
        };
      });

      // Sort availability
      if (sortBy === 'nearest' && lat && lng) {
        availability.sort((a, b) => 
          (a.distance_km || Infinity) - (b.distance_km || Infinity)
        );
      } else if (sortBy === 'cheapest') {
        availability.sort((a, b) => a.price - b.price);
      }
    }

    // Build displayName
    const displayName = med.form
      ? `${med.brandName}${med.pharmacopeia ? ` ${med.pharmacopeia}` : ''} (${capitalize(med.form)})`
      : med.brandName;

    return {
      id: med.id,
      brandName: med.brandName,
      displayName,
      manufacturerName: med.Manufacturer?.name || null,
      manufacturerCountry: med.Manufacturer?.country || null,
      prescriptionRequired: med.prescriptionRequired || false,
      form: med.form,
      packSizeExpression: med.packSizeExpression,
      packSizeUnit: formatPackSizeUnit(med.packSizeUnit),
      ingredients,
      nafdacCode: med.nafdacCode,
      imageUrl: med.imageUrl,
      availability, // Empty array if no location filters
    };
  });
}

module.exports = {
  getSampleMedication,
  getMedicationSuggestions,
  searchMedications,
};
