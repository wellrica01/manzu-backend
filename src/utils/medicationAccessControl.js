/**
 * MEDICATION ACCESS CONTROL
 * 
 * Defines which medications each pharmacy type can access based on regulatory classification
 */

/**
 * Access matrix defining permissions for each pharmacy type
 */
const PHARMACY_ACCESS_MATRIX = {
  PMV: {
    allowedClasses: ['OTC'],
    canDispensePrescriptions: false,
    maxSchedule: null, // Cannot stock scheduled drugs
    description: 'Patent Medicine Vendors - OTC medications only in original packages',
    restrictions: [
      'No prescription medications',
      'No antibiotics or steroids',
      'No injectable medications',
      'Must sell in original manufacturer packaging'
    ]
  },
  
  COMMUNITY: {
    allowedClasses: ['OTC', 'PRESCRIPTION_ONLY', 'SCHEDULE_III', 'SCHEDULE_IV', 'SCHEDULE_V'],
    canDispensePrescriptions: true,
    maxSchedule: 'SCHEDULE_III',
    description: 'Community/Retail Pharmacies - OTC and most prescription medications',
    restrictions: [
      'No Schedule I or II controlled substances without special licensing'
    ]
  },
  
  HOSPITAL: {
    allowedClasses: ['OTC', 'PRESCRIPTION_ONLY', 'SCHEDULE_I', 'SCHEDULE_II', 'SCHEDULE_III', 'SCHEDULE_IV', 'SCHEDULE_V', 'RESTRICTED'],
    canDispensePrescriptions: true,
    canStockControlled: true,
    maxSchedule: 'SCHEDULE_I',
    description: 'Hospital Pharmacies - Full access to all medication classes',
    restrictions: []
  },
  
  SPECIALTY: {
    allowedClasses: ['OTC', 'PRESCRIPTION_ONLY', 'SCHEDULE_I', 'SCHEDULE_II', 'SCHEDULE_III', 'SCHEDULE_IV', 'SCHEDULE_V', 'RESTRICTED'],
    canDispensePrescriptions: true,
    canStockControlled: true,
    specialtyFocus: true,
    maxSchedule: 'SCHEDULE_I',
    description: 'Specialty Pharmacies - Full access with focus on complex/chronic conditions',
    restrictions: []
  },
};

/**
 * Check if a pharmacy type can access a specific medication
 * @param {string} pharmacyType - The type of pharmacy (PMV, COMMUNITY, HOSPITAL, SPECIALTY)
 * @param {Object} medication - Medication object with regulatoryClass and prescriptionRequired
 * @returns {boolean} - Whether the pharmacy can access this medication
 */
function canPharmacyAccessMedication(pharmacyType, medication) {
  const accessRules = PHARMACY_ACCESS_MATRIX[pharmacyType];
  
  if (!accessRules) {
    console.warn(`Unknown pharmacy type: ${pharmacyType}`);
    return false;
  }
  
  // Check regulatory class
  if (medication.regulatoryClass && 
      !accessRules.allowedClasses.includes(medication.regulatoryClass)) {
    return false;
  }
  
  // Check prescription requirement
  if (medication.prescriptionRequired && !accessRules.canDispensePrescriptions) {
    return false;
  }
  
  // Check restrictedTo field (if it exists)
  if (medication.restrictedTo) {
    switch (medication.restrictedTo) {
      case 'HOSPITAL_ONLY':
        return pharmacyType === 'HOSPITAL';
      case 'SPECIALTY_PHARMACY':
        return pharmacyType === 'SPECIALTY';
      case 'CONTROLLED_SUBSTANCE':
        return accessRules.canStockControlled || false;
      case 'COMMUNITY_PHARMACY_ONLY':
        return pharmacyType === 'COMMUNITY';
      case 'GENERAL':
        return true;
      default:
        return true;
    }
  }
  
  return true;
}

/**
 * Get allowed regulatory classes for a pharmacy type
 * @param {string} pharmacyType 
 * @returns {string[]} Array of allowed regulatory classes
 */
function getAllowedRegulatoryClasses(pharmacyType) {
  const accessRules = PHARMACY_ACCESS_MATRIX[pharmacyType];
  return accessRules ? accessRules.allowedClasses : [];
}

/**
 * Get access information for a pharmacy type
 * @param {string} pharmacyType 
 * @returns {Object} Access rules and description
 */
function getPharmacyAccessInfo(pharmacyType) {
  return PHARMACY_ACCESS_MATRIX[pharmacyType] || null;
}

/**
 * Build Prisma where clause for medication filtering by pharmacy type
 * @param {string} pharmacyType 
 * @returns {Object} Prisma where clause
 */
function buildMedicationWhereClause(pharmacyType) {
  const allowedClasses = getAllowedRegulatoryClasses(pharmacyType);
  
  const where = {
    AND: [
      // Regulatory class filter
      {
        OR: [
          { regulatoryClass: { in: allowedClasses } },
          { regulatoryClass: null }, // Include unclassified medications
        ],
      },
    ],
  };
  
  // Additional restrictedTo filtering
  const restrictedToConditions = [
    { restrictedTo: null },
    { restrictedTo: 'GENERAL' },
  ];
  
  // Add pharmacy-specific access
  if (pharmacyType === 'HOSPITAL') {
    restrictedToConditions.push({ restrictedTo: 'HOSPITAL_ONLY' });
  } else if (pharmacyType === 'SPECIALTY') {
    restrictedToConditions.push({ restrictedTo: 'SPECIALTY_PHARMACY' });
  } else if (pharmacyType === 'COMMUNITY') {
    restrictedToConditions.push({ restrictedTo: 'COMMUNITY_PHARMACY_ONLY' });
  }
  
  where.AND.push({ OR: restrictedToConditions });
  
  return where;
}

module.exports = {
  PHARMACY_ACCESS_MATRIX,
  canPharmacyAccessMedication,
  getAllowedRegulatoryClasses,
  getPharmacyAccessInfo,
  buildMedicationWhereClause,
};