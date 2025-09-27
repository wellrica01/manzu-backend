const z = require('zod');

const paginationSchema = z.object({
  page: z.preprocess(
    (val) => parseInt(val ?? '1', 10), // fallback to '1' if undefined/null
    z.number().int().positive()
  ),
  limit: z.preprocess(
    (val) => parseInt(val ?? '10', 10),
    z.number().int().positive().max(100)
  ),
});

const editPharmacySchema = z.object({
  name: z.string().min(1, 'Pharmacy name required'),
  address: z.string().min(1, 'Address required'),
  lga: z.string().min(1, 'LGA required'),
  state: z.string().min(1, 'State required'),
  phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
  licenseNumber: z.string().min(1, 'License number required'),
  status: z.enum(['PENDING', 'VERIFIED', 'SUSPENDED', 'REJECTED', 'CLOSED']),
  logoUrl: z.string().url('Invalid URL').optional().or(z.literal('')).transform((val) => (val === '' ? undefined : val)),
  isActive: z.boolean(),
  pharmacyType: z.enum(['COMMUNITY', 'HOSPITAL', 'SPECIALTY', 'PMV']).optional(),
  ward: z.string().optional(),
  operatingHours: z
  .array(
    z.object({
      dayOfWeek: z.enum([
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY'
      ]),
      openTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:mm)'),
      closeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:mm)'),
    })
  )
  .optional(),
  deliveryAvailability: z.boolean().optional(),
}).merge(paginationSchema);


const createMedicationSchema = z.object({
  brandName: z.string().min(1, 'Brand name required'),
  brandDescription: z.string().optional(),
  manufacturerId: z.number().int().positive().optional(),
  form: z.enum([
    'TABLET','CAPSULE','CAPLET','SYRUP','INJECTION','CREAM','OINTMENT','GEL',
    'SUSPENSION','POWDER','SUPPOSITORY','EYE_DROP','EAR_DROP','DROPS',
    'NASAL_SPRAY','INHALER','PATCH','LOZENGE','EFFERVESCENT'
  ]).optional(),
  packSizeQuantity: z.number().int().optional(), // Changed to int to match DB
  packSizeUnit: z.enum([
    // Fixed to match DB schema (singular forms)
    'TABLET','CAPSULE','ML','VIAL','AMPOULE','SACHET','PATCH','BOTTLE','TUBE','BLISTER'
  ]).optional(),
  nafdacCode: z.string().min(1, 'NAFDAC code required'),
  prescriptionRequired: z.boolean().default(false), // Added default
  imageUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
  
  // Fixed ingredients validation
  ingredients: z.array(
    z.object({
      activeSubstanceId: z.number().int().positive(),
      strengthValue: z.number().positive().optional(),
      strengthUnit: z.enum(['MG','ML','G','MCG','IU','NG','MMOL','PERCENT']).optional(),
      perUnitValue: z.number().positive().optional(),
      // Fixed to match PackSizeUnit enum (singular)
      perUnitType: z.enum(['TABLET','CAPSULE','ML','VIAL','AMPOULE','SACHET','PATCH','BOTTLE','TUBE','BLISTER']).optional(),
      id: z.number().int().positive().optional() // for updates
    }).refine(data => {
      // If strengthValue is provided, strengthUnit should be provided too
      if (data.strengthValue && !data.strengthUnit) return false;
      if (data.perUnitValue && !data.perUnitType) return false;
      return true;
    }, { message: "Strength unit required when strength value is provided" })
  ).min(1, 'At least one active substance is required'),
});

const updateMedicationSchema = createMedicationSchema.partial().extend({
  ingredients: z.array(
    z.object({
      activeSubstanceId: z.number().int().positive(),
      strengthValue: z.number().positive().optional(),
      strengthUnit: z.enum(['MG','ML','G','MCG','IU','NG','MMOL','PERCENT']).optional(),
      perUnitValue: z.number().positive().optional(),
      perUnitType: z.enum(['TABLET','CAPSULE','ML','VIAL','AMPOULE','SACHET','PATCH','BOTTLE','TUBE','BLISTER']).optional(),
      id: z.number().int().positive().optional(),
      // Add action field for update operations
      _action: z.enum(['CREATE', 'UPDATE', 'DELETE']).optional()
    })
  ).optional()
});

// Fixed filter schema to match service parameters
const medicationFilterSchema = z.object({
  brandName: z.string().optional(), // Fixed parameter name
  activeSubstance: z.string().optional(), // Added missing parameter
  prescriptionRequired: z
  .enum(['true','false'])
  .optional()
  .transform(val => (val === undefined ? undefined : val === 'true')),
  pharmacyId: z.string().regex(/^\d+$/).optional().transform(Number),
  manufacturerId: z.string().regex(/^\d+$/).optional().transform(Number), // Added
  form: z.enum([
    'TABLET','CAPSULE','CAPLET','SYRUP','INJECTION','CREAM','OINTMENT','GEL',
    'SUSPENSION','POWDER','SUPPOSITORY','EYE_DROP','EAR_DROP','DROPS',
    'NASAL_SPRAY','INHALER','PATCH','LOZENGE','EFFERVESCENT'
  ]).optional(),
  nafdacStatus: z.enum(['VALID','EXPIRED','PENDING','SUSPENDED']).optional()
}).merge(paginationSchema);


const prescriptionFilterSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']).optional(),
  userIdentifier: z.string().optional(),
}).merge(paginationSchema);

const orderFilterSchema = z.object({
  status: z.enum(['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED', 'COMPLETED']).optional(),
  userIdentifier: z.string().optional(),
}).merge(paginationSchema);


const adminUserFilterSchema = z.object({
  role: z.enum(['ADMIN', 'SUPER_ADMIN', 'SUPPORT']).optional(),
  email: z.string().optional(),
  pharmacyId: z.string().regex(/^\d+$/).optional().transform(json => Number(json)),
}).merge(paginationSchema);

const pharmacyUserFilterSchema = z.object({
  role: z.enum(['MANAGER', 'PHARMACIST', 'ADMIN', 'STAFF', 'OWNER', 'TECHNICIAN']).optional(),
  email: z.string().optional(),
  pharmacyId: z.string().regex(/^\d+$/).optional().transform(Number),
}).merge(paginationSchema);


const registerSchema = z.object({
  pharmacy: z.object({
    name: z.string().min(1, 'Pharmacy name required'),
    address: z.string().min(1, 'Address required'),
    lga: z.string().min(1, 'LGA required'),
    state: z.string().min(1, 'State required'),
    ward: z.string().min(1, 'Ward required'),
    latitude: z.number().min(-90).max(90, 'Invalid latitude'),
    longitude: z.number().min(-180).max(180, 'Invalid longitude'),
    phone: z.string().regex(/^[+]?\d{10,15}$/, 'Invalid phone number'),
    licenseNumber: z.string().min(1, 'License number required'),
    logoUrl: z.string().url('Invalid URL').optional(),
    pharmacyType: z.enum(['COMMUNITY', 'HOSPITAL', 'SPECIALTY', 'PMV']).optional(),
    operatingHours: z
  .array(
    z.object({
      dayOfWeek: z.enum([
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY'
      ]),
      openTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:mm)'),
      closeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:mm)'),
    })
  )
  .optional(),
    deliveryAvailability: z.boolean().optional(),
  }),
  user: z.object({
    name: z.string().min(1, 'User name required'),
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});


const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
});


const addUserSchema = z.object({
  name: z.string().min(1, 'User name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['MANAGER', 'PHARMACIST', 'ADMIN', 'STAFF', 'OWNER', 'TECHNICIAN'], 'Role must be a valid pharmacy user role'),
});


const editUserSchema = z.object({
  name: z.string().min(1, 'User name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  role: z.enum(['MANAGER', 'PHARMACIST', 'ADMIN', 'STAFF', 'OWNER', 'TECHNICIAN']).optional(),
});

const editProfileSchema = z.object({
  user: z.object({
    name: z.string().min(1, 'User name required'),
    email: z.string().email('Invalid email'),
  }),
  pharmacy: z.object({
    name: z.string().min(1, 'Pharmacy name required'),
    address: z.string().min(1, 'Address required'),
    lga: z.string().min(1, 'LGA required'),
    state: z.string().min(1, 'State required'),
    ward: z.string().min(1, 'Ward required'),
    latitude: z.number().min(-90).max(90, 'Invalid latitude'),
    longitude: z.number().min(-180).max(180, 'Invalid longitude'),
    phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
    logoUrl: z.string().url('Invalid URL').optional(),
  }),
});


const adminRegisterSchema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const adminLoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
});


// --- GENERIC NAMES ---

const GenericNameSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

const GenericNameUpdateSchema = GenericNameSchema.partial();



// ACTIVE SUBSTANCE
const ActiveSubstanceSchema = z.object({
  name: z.string().min(1, "Active substance name is required"),
  description: z.string().optional(),
  atcCode: z.string().optional(), // optional link to ATC
  parentId: z.number().int().positive().optional(), // if substances are hierarchical
});

const ActiveSubstanceUpdateSchema = ActiveSubstanceSchema.partial();

// --- MEDICATION INGREDIENTS ---
const MedicationIngredientSchema = z.object({
  substanceId: z.number().int().positive(),
  strengthValue: z.number().optional(),
  strengthUnit: z.string().optional(),  // You might want to restrict to enum values
  perUnitValue: z.number().optional(),
  perUnitType: z.string().optional(),   // Same here, can be tied to PackSizeUnit enum
});

const MedicationIngredientUpdateSchema = MedicationIngredientSchema.partial();

// --- ATC ADMIN ROUTES ---
// Covers: AnatomicalClass, TherapeuticClass, PharmacologicalClass, ChemicalClass, ChemicalSubstance
const AnatomicalClassSchema = z.object({
  atcCode: z.string().length(1, "ATC code must be a single character"),
  name: z.string().min(1, "Name is required"),
});
const AnatomicalClassUpdateSchema = AnatomicalClassSchema.partial();

const TherapeuticClassSchema = z.object({
  atcCode: z.string().length(3, "ATC code must be 3 characters"),
  name: z.string().min(1, "Name is required"),
  parentId: z.number().int().positive(),
});
const TherapeuticClassUpdateSchema = TherapeuticClassSchema.partial();

const PharmacologicalClassSchema = z.object({
  atcCode: z.string().length(4, "ATC code must be 4 characters"),
  name: z.string().min(1, "Name is required"),
  parentId: z.number().int().positive(),
});
const PharmacologicalClassUpdateSchema = PharmacologicalClassSchema.partial();

const ChemicalClassSchema = z.object({
  atcCode: z.string().length(5, "ATC code must be 5 characters"),
  name: z.string().min(1, "Name is required"),
  parentId: z.number().int().positive(),
});
const ChemicalClassUpdateSchema = ChemicalClassSchema.partial();

const ChemicalSubstanceSchema = z.object({
  atcCode: z.string().length(7, "ATC code must be 7 characters"),
  name: z.string().min(1, "Name is required"),
  parentId: z.number().int().positive(),
});
const ChemicalSubstanceUpdateSchema = ChemicalSubstanceSchema.partial();


// MANUFACTURER
const manufacturerSchema = z.object({
  name: z.string().min(1, 'Manufacturer name required'),
  country: z.string().optional(),
  contactInfo: z.string().optional(),
});

// GENERIC MEDICATION
const genericMedicationSchema = z.object({
  name: z.string().min(1, 'Generic medication name required'),
  inn: z.string().optional(),
  atcCode: z.string().optional(),
  description: z.string().optional(),
  translations: z.any().optional(),
  categoryIds: z.array(z.number().int().positive()).optional(),
  chemicalClassIds: z.array(z.number().int().positive()).optional(),
  therapeuticClassIds: z.array(z.number().int().positive()).optional(),
});

// INDICATION
const indicationSchema = z.object({
  genericMedicationId: z.number().int().positive(),
  indication: z.string().min(1, 'Indication required'),
  translations: z.any().optional(),
});

module.exports = {
  // Core
  paginationSchema,

  // Pharmacy
  editPharmacySchema,
  registerSchema,
  editProfileSchema,

  // Users
  loginSchema,
  addUserSchema,
  editUserSchema,
  adminRegisterSchema,
  adminLoginSchema,

  // Medications
  createMedicationSchema,
  updateMedicationSchema,
  medicationFilterSchema,

  // Filters
  prescriptionFilterSchema,
  orderFilterSchema,
  adminUserFilterSchema,
  pharmacyUserFilterSchema,

  // Manufacturers & Generics
  manufacturerSchema,
  genericMedicationSchema,
  indicationSchema,

  // Generic Names
  GenericNameSchema,
  GenericNameUpdateSchema,

  // Active Substances
  ActiveSubstanceSchema,
  ActiveSubstanceUpdateSchema,

  // Medication Ingredients
  MedicationIngredientSchema,
  MedicationIngredientUpdateSchema,

  // ATC Classification
  AnatomicalClassSchema,
  AnatomicalClassUpdateSchema,
  TherapeuticClassSchema,
  TherapeuticClassUpdateSchema,
  PharmacologicalClassSchema,
  PharmacologicalClassUpdateSchema,
  ChemicalClassSchema,
  ChemicalClassUpdateSchema,
  ChemicalSubstanceSchema,
  ChemicalSubstanceUpdateSchema,
};
