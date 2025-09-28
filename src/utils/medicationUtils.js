function formatDisplayName(med) {
  // Use brandName, strengthValue, strengthUnit, form, and genericMedication.name if available
  const brand = med.brandName || med.name || '';
  const generic = med.genericMedication?.name ? ` [${med.genericMedication.name}]` : '';
  const strength = med.strengthValue ? ` ${med.strengthValue}${med.strengthUnit ? med.strengthUnit : ''}` : '';
  const form = med.form ? ` (${med.form})` : '';
  return `${brand}${strength}${form}${generic}`.trim();
}


// Capitalize first letter
function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Map for strength units
const strengthUnitMap = {
  MG: "mg",
  ML: "mL",
  G: "g",
  MCG: "µg",
  IU: "IU",
  NG: "ng",
  MMOL: "mmol",
  PERCENT: "%"
};

// Map for pack size units
const packSizeUnitMap = {
  TABLET: "Tablet",
  CAPSULE: "Capsule",
  ML: "mL",
  VIAL: "Vial",
  AMPOULE: "Ampoule",
  SACHET: "Sachet",
  PATCH: "Patch",
  BOTTLE: "Bottle",
  TUBE: "Tube",
  BLISTER: "Blister"
};

// Normalize strength unit
function formatStrengthUnit(unit) {
  return strengthUnitMap[unit] || unit;
}

// Normalize pack size unit
function formatPackSizeUnit(unit) {
  return packSizeUnitMap[unit] || capitalize(unit);
}

// Normalize per-unit type
function formatPerUnitType(perUnit) {
  if (!perUnit) return perUnit;
  return perUnit
    .toLowerCase()
    .replace(/\bml\b/g, "mL")      // replace ml with mL
    .replace(/\bmg\b/g, "mg")      // ensure mg stays lowercase
    .replace(/\bµg\b/g, "µg");     // micrograms
}



module.exports = { formatDisplayName, capitalize, formatPerUnitType, formatPackSizeUnit, formatStrengthUnit };