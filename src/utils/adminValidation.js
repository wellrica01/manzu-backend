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
  operatingHours: z.string().optional(),
  deliveryAvailability: z.boolean().optional(),
}).merge(paginationSchema);


const createMedicationSchema = z.object({
  brandName: z.string().min(1, 'Brand name required'),
  genericMedicationId: z.number().int().positive(),
  brandDescription: z.string().optional(),
  manufacturerId: z.number().int().positive().optional(),
  form: z.enum(['TABLET','CAPSULE','CAPLET','SYRUP','INJECTION','CREAM','OINTMENT','GEL','SUSPENSION','POWDER','SUPPOSITORY','EYE_DROP','EAR_DROP','DROPS','NASAL_SPRAY','INHALER','PATCH','LOZENGE','EFFERVESCENT']).optional(),
  strengthValue: z.number().optional(),
  strengthUnit: z.enum(['MG','ML','G','MCG','IU','NG','MMOL','PERCENT']).optional(),
  route: z.enum(['ORAL','INTRAVENOUS','INTRAMUSCULAR','SUBCUTANEOUS','TOPICAL','INHALATION','RECTAL','VAGINAL','OPHTHALMIC','OTIC','NASAL','SUBLINGUAL','BUCCAL','TRANSDERMAL']).optional(),
  packSizeQuantity: z.number().optional(),
  packSizeUnit: z.enum(['TABLETS','CAPSULES','ML','VIALS','AMPOULES','SACHETS','PATCHES','BOTTLES','TUBES','BLISTERS']).optional(),
  isCombination: z.boolean().optional(),
  combinationDescription: z.string().optional(),
  nafdacCode: z.string().min(1, 'NAFDAC code required'),
  nafdacStatus: z.enum(['VALID','EXPIRED','PENDING','SUSPENDED']).optional(),
  prescriptionRequired: z.boolean(),
  regulatoryClass: z.enum(['OTC','PRESCRIPTION_ONLY','SCHEDULE_I','SCHEDULE_II','SCHEDULE_III','SCHEDULE_IV','SCHEDULE_V','RESTRICTED']).optional(),
  restrictedTo: z.enum(['GENERAL','HOSPITAL_ONLY','SPECIALTY_PHARMACY','CONTROLLED_SUBSTANCE']).optional(),
  insuranceCoverage: z.boolean().optional(),
  approvalDate: z.string().optional(),
  expiryDate: z.string().optional(),
  storageConditions: z.string().optional(),
  imageUrl: z.string().url('Invalid URL').optional(),
});

const updateMedicationSchema = createMedicationSchema.partial();


const medicationFilterSchema = z.object({
  brandName: z.string().optional(),
  genericMedicationId: z.string().regex(/^\d+$/).optional().transform(Number),
  prescriptionRequired: z.enum(['true', 'false']).optional().transform((val) => val === 'true'),
  pharmacyId: z.string().regex(/^\d+$/).optional().transform(Number),
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
    operatingHours: z.string().optional(),
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

// CATEGORY
const categorySchema = z.object({
  name: z.string().min(1, 'Category name required'),
});

// THERAPEUTIC CLASS
const therapeuticClassSchema = z.object({
  name: z.string().min(1, 'Therapeutic class name required'),
});

// CHEMICAL CLASS
const chemicalClassSchema = z.object({
  name: z.string().min(1, 'Chemical class name required'),
});

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
  editPharmacySchema,
  createMedicationSchema,
  updateMedicationSchema,
  medicationFilterSchema,
  prescriptionFilterSchema,
  orderFilterSchema,
  adminUserFilterSchema,
  pharmacyUserFilterSchema,
  registerSchema,
  loginSchema,
  addUserSchema,
  editUserSchema,
  editProfileSchema,
  adminRegisterSchema,
  adminLoginSchema,
  paginationSchema,
  categorySchema,
  therapeuticClassSchema,
  chemicalClassSchema,
  manufacturerSchema,
  genericMedicationSchema,
  indicationSchema,
};