const z = require('zod');

const paginationSchema = z.object({
  page: z.preprocess(
    (val) => parseInt(val ?? '1', 10),
    z.number().int().positive()
  ),
  limit: z.preprocess(
    (val) => parseInt(val ?? '10', 10),
    z.number().int().positive().max(100)
  ),
});

const editProviderSchema = z.object({
  name: z.string().min(1, 'Provider name required'),
  address: z.string().min(1, 'Address required'),
  lga: z.string().min(1, 'LGA required'),
  state: z.string().min(1, 'State required'),
  phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
  licenseNumber: z.string().min(1, 'License number required').optional(),
  status: z.enum(['pending', 'verified', 'rejected']),
  logoUrl: z.string().url('Invalid URL').optional().or(z.literal('')).transform((val) => (val === '' ? undefined : val)),
  isActive: z.boolean(),
  homeCollectionAvailable: z.boolean().optional(),
}).merge(paginationSchema);

const createServiceSchema = z.object({
  name: z.string().min(1, 'Service name required'),
  type: z.enum(['medication', 'diagnostic', 'diagnostic_package']),
  genericName: z.string().min(1, 'Generic name required').optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  manufacturer: z.string().optional(),
  form: z.string().optional(),
  dosage: z.string().optional(),
  nafdacCode: z.string().optional(),
  testType: z.string().optional(),
  testCode: z.string().optional(),
  prepInstructions: z.string().optional(),
  prescriptionRequired: z.boolean(),
  imageUrl: z.preprocess((val) => (val === '' ? undefined : val), z.string().url('Invalid URL').optional()),
});

const updateServiceSchema = z.object({
  name: z.string().min(1, 'Service name required'),
  type: z.enum(['medication', 'diagnostic', 'diagnostic_package']),
  genericName: z.string().min(1, 'Generic name required').optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  manufacturer: z.string().optional(),
  form: z.string().optional(),
  dosage: z.string().optional(),
  nafdacCode: z.string().optional(),
  testType: z.string().optional(),
  testCode: z.string().optional(),
  prepInstructions: z.string().optional(),
  prescriptionRequired: z.boolean(),
  imageUrl: z.preprocess((val) => (val === '' ? undefined : val), z.string().url('Must be a valid URL').optional()),
});

const serviceFilterSchema = z.object({
  name: z.string().optional(),
  genericName: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(['medication', 'diagnostic', 'diagnostic_package']).optional(),
  prescriptionRequired: z.enum(['true', 'false']).optional().transform((val) => val === 'true'),
  providerId: z.string().regex(/^\d+$/).optional().transform(Number),
}).merge(paginationSchema);

const prescriptionFilterSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  patientIdentifier: z.string().optional(),
}).merge(paginationSchema);

const orderFilterSchema = z.object({
  status: z.enum(['cart', 'pending', 'pending_prescription', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'scheduled', 'completed', 'cancelled']).optional(),
  patientIdentifier: z.string().optional(),
}).merge(paginationSchema);

const adminUserFilterSchema = z.object({
  role: z.enum(['admin', 'support']).optional(),
  email: z.string().optional(),
  providerId: z.string().regex(/^\d+$/).optional().transform(json => Number(json)),
}).merge(paginationSchema);

const providerUserFilterSchema = z.object({
  role: z.enum(['manager', 'pharmacist', 'technician']).optional(),
  email: z.string().optional(),
  providerId: z.string().regex(/^\d+$/).optional().transform(Number),
}).merge(paginationSchema);

const registerSchema = z.object({
  provider: z.object({
    name: z.string().min(1, 'Provider name required'),
    address: z.string().min(1, 'Address required'),
    lga: z.string().min(1, 'LGA required'),
    state: z.string().min(1, 'State required'),
    ward: z.string().min(1, 'Ward required'),
    latitude: z.number().min(-90).max(90, 'Invalid latitude'),
    longitude: z.number().min(-180).max(180, 'Invalid longitude'),
    phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
    licenseNumber: z.string().min(1, 'License number required').optional(),
    logoUrl: z.string().url('Invalid URL').optional(),
    homeCollectionAvailable: z.boolean().optional(),
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
  role: z.enum(['pharmacist', 'technician']),
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
  provider: z.object({
    name: z.string().min(1, 'Provider name required'),
    address: z.string().min(1, 'Address required'),
    lga: z.string().min(1, 'LGA required'),
    state: z.string().min(1, 'State required'),
    ward: z.string().min(1, 'Ward required'),
    latitude: z.number().min(-90).max(90, 'Invalid latitude'),
    longitude: z.number().min(-180).max(180, 'Invalid longitude'),
    phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
    logoUrl: z.string().url('Invalid URL').optional(),
    homeCollectionAvailable: z.boolean().optional(),
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
  editProviderSchema,
  createServiceSchema,
  updateServiceSchema,
  serviceFilterSchema,
  prescriptionFilterSchema,
  orderFilterSchema,
  adminUserFilterSchema,
  providerUserFilterSchema,
  registerSchema,
  loginSchema,
  addUserSchema,
  editUserSchema,
  editProfileSchema,
  adminRegisterSchema,
  adminLoginSchema,
  paginationSchema,
};