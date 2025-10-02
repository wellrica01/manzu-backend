// ============================================================================
// DISPLAY & FORMATTING UTILITIES
// ============================================================================

/**
 * Format a medication's display name with brand, strength, form, and generic name
 * @param {Object} med - Medication object
 * @returns {string} Formatted display name
 */
function formatDisplayName(med) {
  // Use brandName, strengthValue, strengthUnit, form, and genericMedication.name if available
  const brand = med.brandName || med.name || '';
  const generic = med.genericMedication?.name ? ` [${med.genericMedication.name}]` : '';
  const strength = med.strengthValue ? ` ${med.strengthValue}${med.strengthUnit ? med.strengthUnit : ''}` : '';
  const form = med.form ? ` (${med.form})` : '';
  return `${brand}${strength}${form}${generic}`.trim();
}

/**
 * Capitalize enum strings like NASAL_SPRAY → Nasal Spray
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
  if (!str) return str;
  return str
    .toLowerCase()
    .split('_')                 // split by underscores
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // capitalize each word
    .join(' ');                 // join with space
}

// ============================================================================
// UNIT MAPPING & NORMALIZATION
// ============================================================================

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

/**
 * Normalize strength unit using predefined map
 * @param {string} unit - Unit to normalize
 * @returns {string} Normalized unit
 */
function formatStrengthUnit(unit) {
  return strengthUnitMap[unit] || unit;
}

/**
 * Normalize pack size unit using predefined map
 * @param {string} unit - Unit to normalize
 * @returns {string} Normalized unit
 */
function formatPackSizeUnit(unit) {
  return packSizeUnitMap[unit] || capitalize(unit);
}

/**
 * Normalize per-unit type (e.g., ml → mL, mg stays mg)
 * @param {string} perUnit - Per unit type to normalize
 * @returns {string} Normalized per unit type
 */
function formatPerUnitType(perUnit) {
  if (!perUnit) return perUnit;
  return perUnit
    .toLowerCase()
    .replace(/\bml\b/g, "mL")      // replace ml with mL
    .replace(/\bmg\b/g, "mg")      // ensure mg stays lowercase
    .replace(/\bµg\b/g, "µg");     // micrograms
}

// ============================================================================
// PARSING & VALIDATION UTILITIES
// ============================================================================

/**
 * Parse a string value to integer
 * @param {string|number} value - Value to parse
 * @returns {number|undefined} Parsed integer or undefined
 */
function parseInteger(value) {
  return value && value !== '' ? parseInt(value, 10) : undefined;
}

/**
 * Normalize a value to boolean
 * @param {string|boolean} value - Value to normalize
 * @returns {boolean} Normalized boolean
 */
function normalizeBoolean(value) {
  return value === 'true' || value === true;
}

/**
 * Parse ingredients from JSON string
 * @param {string} raw - Raw JSON string
 * @param {Object} res - Express response object
 * @returns {Array|null} Parsed ingredients array or null if invalid
 */
function parseIngredients(raw, res) {
  if (!raw || raw === '') return [];
  try {
    return JSON.parse(raw);
  } catch {
    res.status(400).json({ success: false, message: 'Invalid ingredients JSON' });
    return null; // stop processing
  }
}

/**
 * Compute total quantity from a pack size expression like "10 x 10"
 * @param {string} expression - Pack size expression
 * @returns {number|null} Computed quantity or null if parsing fails
 */
function computePackSizeQuantity(expression) {
  if (!expression) return null;

  // Split on "x", "X", or "*" and parse numbers
  const parts = expression.split(/[xX*]/).map(p => parseInt(p.trim(), 10));

  // If all parts are valid numbers, multiply them
  return parts.every(n => !isNaN(n)) ? parts.reduce((a, b) => a * b, 1) : null;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Normalize medication fields from request body
 * Parses integers, booleans, and ingredients
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function normalizeMedicationFields(req, res, next) {
  const fields = { ...req.body };

  fields.manufacturerId = parseInteger(fields.manufacturerId);
  fields.packSizeQuantity = parseInteger(fields.packSizeQuantity);
  fields.prescriptionRequired = normalizeBoolean(fields.prescriptionRequired);

  const ingredients = parseIngredients(fields.ingredients, res);
  if (ingredients === null) return; // stops middleware if invalid
  fields.ingredients = ingredients;

  req.normalizedFields = fields;
  next();
}

// ============================================================================
// IMAGE UPLOAD HANDLING
// ============================================================================

const FALLBACK_IMAGE_URL = 'https://manzu.ng/placeholder-medication.png'; 
// ⬆️ replace with your actual hosted placeholder image

/**
 * Handle image upload to Supabase storage
 * Validates file type and size, returns public URL or fallback
 * @param {Object} file - Multer file object
 * @param {Object} supabase - Supabase client instance
 * @returns {Promise<string|null>} Public URL of uploaded image or fallback
 */
async function handleImageUpload(file, supabase) {
  if (!file) return null;

  try {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(file.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, WebP allowed.');
    }
    if (file.size > maxSize) {
      throw new Error('File too large. Max 5MB.');
    }

    const fileName = `medications/${Date.now()}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('medications')
      .upload(fileName, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from('medications')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl || FALLBACK_IMAGE_URL;
  } catch (err) {
    console.error('Image upload failed, using fallback image:', err.message);
    return FALLBACK_IMAGE_URL;
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Resolve manufacturer from ID or name
 * - If ID provided, validates existence
 * - If name provided, finds existing or creates new manufacturer
 * @param {Object} tx - Prisma transaction object
 * @param {Object} data - Data containing manufacturerId or manufacturerName
 * @returns {Promise<number|null>} Manufacturer ID or null
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
 * - Creates new ingredients if they don't exist
 * - Optionally deletes orphaned ingredients
 * @param {Object} tx - Prisma transaction object
 * @param {number} medicationId - Medication ID to link ingredients to
 * @param {Array} ingredients - Array of ingredient objects
 * @param {boolean} removeOrphans - Whether to remove orphaned ingredients
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

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = { 
  formatDisplayName, 
  capitalize, 
  formatPerUnitType, 
  formatPackSizeUnit, 
  formatStrengthUnit, 
  computePackSizeQuantity, 
  resolveManufacturer, 
  linkIngredients, 
  normalizeMedicationFields, 
  handleImageUpload 
};