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
  status: z.enum(['pending', 'verified', 'rejected']),
  logoUrl: z.string().url('Invalid URL').optional().or(z.literal('')).transform((val) => (val === '' ? undefined : val)),
  isActive: z.boolean(),
}).merge(paginationSchema);


const createMedicationSchema = z.object({
  name: z.string().min(1, 'Medication name required'),
  genericName: z.string().min(1, 'Generic name required'),
  category: z.string().optional(),
  description: z.string().optional(),
  manufacturer: z.string().optional(),
  form: z.string().optional(),
  dosage: z.string().optional(),
  nafdacCode: z.string().optional(),
  prescriptionRequired: z.boolean(),
  imageUrl: z.preprocess((val) => (val === '' ? undefined : val), z.string().url('Invalid URL').optional()),
});

const updateMedicationSchema = z.object({
  name: z.string().min(1, 'Medication name required'),
  genericName: z.string().min(1, 'Generic name required'),
  category: z.string().optional(),
  description: z.string().optional(),
  manufacturer: z.string().optional(),
  form: z.string().optional(),
  dosage: z.string().optional(),
  nafdacCode: z.string().optional(),
  prescriptionRequired: z.boolean(),
  imageUrl: z.preprocess((val) => (val === '' ? undefined : val), z.string().url('Must be a valid URL').optional()),
});


const medicationFilterSchema = z.object({
  name: z.string().optional(),
  genericName: z.string().optional(),
  category: z.string().optional(),
  prescriptionRequired: z.enum(['true', 'false']).optional().transform((val) => val === 'true'),
  pharmacyId: z.string().regex(/^\d+$/).optional().transform(Number),
}).merge(paginationSchema);


const prescriptionFilterSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  patientIdentifier: z.string().optional(),
}).merge(paginationSchema);

const orderFilterSchema = z.object({
  status: z.enum(['cart', 'pending', 'pending_prescription', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled']).optional(),
  patientIdentifier: z.string().optional(),
}).merge(paginationSchema);


const adminUserFilterSchema = z.object({
  role: z.enum(['admin', 'support']).optional(),
  email: z.string().optional(),
  pharmacyId: z.string().regex(/^\d+$/).optional().transform(json => Number(json)),
}).merge(paginationSchema);

const pharmacyUserFilterSchema = z.object({
  role: z.enum(['manager', 'pharmacist']).optional(),
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
    phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
    licenseNumber: z.string().min(1, 'License number required'),
    logoUrl: z.string().url('Invalid URL').optional(),
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
  role: z.enum(['pharmacist'], 'Role must be pharmacist'),
});


const editUserSchema = z.object({
  name: z.string().min(1, 'User name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
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
};