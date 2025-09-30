function formatDisplayName(med) {
  // Use brandName, strengthValue, strengthUnit, form, and genericMedication.name if available
  const brand = med.brandName || med.name || '';
  const generic = med.genericMedication?.name ? ` [${med.genericMedication.name}]` : '';
  const strength = med.strengthValue ? ` ${med.strengthValue}${med.strengthUnit ? med.strengthUnit : ''}` : '';
  const form = med.form ? ` (${med.form})` : '';
  return `${brand}${strength}${form}${generic}`.trim();
}


// Capitalize enum strings like NASAL_SPRAY → Nasal Spray
function capitalize(str) {
  if (!str) return str;
  return str
    .toLowerCase()
    .split('_')                 // split by underscores
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // capitalize each word
    .join(' ');                 // join with space
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


/**
 * Compute total quantity from a pack size expression like "10 x 10"
 * Returns a number or null if parsing fails
 */
function computePackSizeQuantity(expression) {
  if (!expression) return null;

  // Split on "x", "X", or "*" and parse numbers
  const parts = expression.split(/[xX*]/).map(p => parseInt(p.trim(), 10));

  // If all parts are valid numbers, multiply them
  return parts.every(n => !isNaN(n)) ? parts.reduce((a, b) => a * b, 1) : null;
}

/**
 * Resolve manufacturer:
 * - If an existing manufacturer ID is provided, use it
 * - If a name is provided, check if it exists; create if not
 */
async function resolveManufacturer(tx, data) {
  let manufacturerId = null;

  if (data.manufacturerId) {
    const manufacturer = await tx.manufacturer.findUnique({ where: { id: data.manufacturerId } });
    if (!manufacturer) throw new Error('Manufacturer not found');
    manufacturerId = data.manufacturerId;
  } else if (data.manufacturerName) {
    let manufacturer = await tx.manufacturer.findUnique({ where: { name: data.manufacturerName.trim() } });

    if (!manufacturer) {
      // Create new manufacturer if it doesn't exist
      manufacturer = await tx.manufacturer.create({
        data: {
          name: data.manufacturerName.trim(),
          country: data.manufacturerCountry || null,
          contactInfo: data.manufacturerContact || null,
        },
      });
      console.log('New manufacturer created:', manufacturer.name);
    }

    manufacturerId = manufacturer.id;
  }

  return manufacturerId;
}

/**
 * Link ingredients to a medication
 * - Creates new ingredients if not exist
 * - Optionally deletes orphaned ingredients
 */
async function linkIngredients(tx, medicationId, ingredients, removeOrphans = false) {
  if (!Array.isArray(ingredients)) return;

  const currentLinks = removeOrphans
    ? await tx.medication_MedicationIngredient.findMany({ where: { medicationId } })
    : [];

  const newIngredientIds = [];

  for (const ingredient of ingredients) {
    // Check if ingredient already exists
    let medIngredient = await tx.medicationIngredient.findFirst({
      where: {
        substanceId: ingredient.activeSubstanceId,
        strengthValue: ingredient.strengthValue || null,
        strengthUnit: ingredient.strengthUnit || null,
        perUnitType: ingredient.perUnitType || null,
      },
    });

    // Create new ingredient if not found
    if (!medIngredient) {
      medIngredient = await tx.medicationIngredient.create({
        data: {
          substanceId: ingredient.activeSubstanceId,
          strengthValue: ingredient.strengthValue || null,
          strengthUnit: ingredient.strengthUnit || null,
          perUnitValue: ingredient.perUnitValue || null,
          perUnitType: ingredient.perUnitType || null,
        },
      });
    }

    newIngredientIds.push(medIngredient.id);

    // Link ingredient to medication
    await tx.medication_MedicationIngredient.create({
      data: { medicationId, ingredientId: medIngredient.id },
    });
  }

  // Delete orphaned ingredients if requested
  if (removeOrphans && currentLinks.length > 0) {
    const previousIds = currentLinks.map(l => l.ingredientId);
    const orphanIds = previousIds.filter(pid => !newIngredientIds.includes(pid));

    if (orphanIds.length > 0) {
      await tx.medicationIngredient.deleteMany({
        where: { id: { in: orphanIds }, Medication_MedicationIngredient: { none: {} } },
      });
    }
  }
}



module.exports = { formatDisplayName, capitalize, formatPerUnitType, formatPackSizeUnit, formatStrengthUnit, computePackSizeQuantity, resolveManufacturer, linkIngredients };