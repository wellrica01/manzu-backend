const express = require('express');
const { PrismaClient } = require('@prisma/client');
const z = require('zod');
const NodeGeocoder = require('node-geocoder');
const jwt = require('jsonwebtoken');
const router = express.Router();
const prisma = new PrismaClient();

const geocoder = NodeGeocoder({
  provider: 'opencage',
  apiKey: process.env.OPENCAGE_API_KEY,
});

// Validation schemas
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
});

// Validation schema for creating medication
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
  imageUrl: z.preprocess((val) => (val === '' ? undefined : val),  z.string().url('Invalid URL').optional()),
});

// Validation schema for updating medication
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
  imageUrl: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url('Must be a valid URL').optional()
  ),
});

// Pagination schema
const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).optional().default('1').transform(Number),
  limit: z.string().regex(/^\d+$/).optional().default('10').transform(Number),
});

// Validation schema for medication filters
const medicationFilterSchema = z.object({
  name: z.string().optional(),
  genericName: z.string().optional(),
  category: z.string().optional(),
  prescriptionRequired: z.enum(['true', 'false']).optional().transform((val) => val === 'true'),
}).merge(paginationSchema);

// Validation schema for prescription filters
const prescriptionFilterSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  patientIdentifier: z.string().optional(),
}).merge(paginationSchema);

// Validation schema for order filters
const orderFilterSchema = z.object({
  page: z.string().regex(/^\d+$/).default('1').transform(Number),
  limit: z.string().regex(/^\d+$/).default('10').transform(Number),
  status: z.enum(['cart', 'pending', 'pending_prescription', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled']).optional(),
  patientIdentifier: z.string().optional(),
});

// Validation schema for admin user filters
const adminUserFilterSchema = z.object({
  page: z.string().regex(/^\d+$/).default('1').transform(Number),
  limit: z.string().regex(/^\d+$/).default('10').transform(Number),
  role: z.enum(['admin', 'support']).optional(),
  email: z.string().optional(),
});

// Validation schema for pharmacy user filters
const pharmacyUserFilterSchema = z.object({
  page: z.string().regex(/^\d+$/).default('1').transform(Number),
  limit: z.string().regex(/^\d+$/).default('10').transform(Number),
  role: z.enum(['manager', 'pharmacist']).optional(),
  email: z.string().optional(),
  pharmacyId: z.string().regex(/^\d+$/).transform(Number).optional(),
});


// Middleware to verify JWT and admin role
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided');
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log('Token verified:', { adminId: decoded.adminId, role: decoded.role });
    next();
  } catch (error) {
    console.error('Invalid token:', { message: error.message });
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const authenticateAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    console.error('Unauthorized: Not an admin', { adminId: req.user.adminId });
    return res.status(403).json({ message: 'Only admins can perform this action' });
  }
  next();
};

// Dashboard overview
router.get('/dashboard', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/dashboard');
    const [pharmacyCount, medicationCount, prescriptionCount, userCount, orderCount, pendingPrescriptions, verifiedPharmacies, recentOrders] = await prisma.$transaction([
      prisma.pharmacy.count(),
      prisma.medication.count(),
      prisma.prescription.count(),
      prisma.pharmacyUser.count(),
      prisma.order.count(),
      prisma.prescription.count({ where: { status: 'pending' } }),
      prisma.pharmacy.count({ where: { status: 'verified' } }),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, trackingCode: true, patientIdentifier: true, totalPrice: true, status: true, createdAt: true },
      }),
    ]);
    const summary = {
      pharmacies: { total: pharmacyCount, verified: verifiedPharmacies },
      medications: { total: medicationCount },
      prescriptions: { total: prescriptionCount, pending: pendingPrescriptions },
      users: { total: userCount },
      orders: { total: orderCount, recent: recentOrders },
    };
    console.log('Dashboard data fetched:', summary);
    res.status(200).json({ message: 'Dashboard data fetched successfully', summary });
  } catch (error) {
    console.error('Fetch dashboard error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all pharmacies
router.get('/pharmacies', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/pharmacies');
    const { page, limit } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const [pharmacies, total] = await prisma.$transaction([
      prisma.pharmacy.findMany({
        select: {
          id: true,
          name: true,
          address: true,
          lga: true,
          state: true,
          phone: true,
          licenseNumber: true,
          status: true,
          logoUrl: true,
          isActive: true,
          createdAt: true,
          verifiedAt: true,
        },
        take: limit,
        skip,
      }),
      prisma.pharmacy.count(),
    ]);
    console.log('Pharmacies fetched:', { count: pharmacies.length, total });
    res.status(200).json({
      message: 'Pharmacies fetched successfully',
      pharmacies,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Fetch pharmacies error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get pharmacies for filter dropdown
router.get('/pharmacies/simple', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/pharmacies/simple');
    const simplePharmacies = await prisma.pharmacy.findMany({
      select: {
        id: true,
        name: true,
      },
    });
    console.log('Pharmacies fetched for filter:', { count: simplePharmacies.length });
    res.status(200).json({ message: 'Pharmacies fetched successfully', simplePharmacies });
  } catch (error) {
    console.error('Fetch pharmacies error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single pharmacy
router.get('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    if (isNaN(parsedId)) {
      return res.status(400).json({ message: 'Invalid pharmacy ID' });
    }
    console.log('Received request for /api/admin/pharmacies/:id', { pharmacyId: parsedId });
    const pharmacy = await prisma.pharmacy.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        name: true,
        address: true,
        lga: true,
        state: true,
        phone: true,
        licenseNumber: true,
        status: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        verifiedAt: true,
      },
    });
    if (!pharmacy) {
      console.error('Pharmacy not found:', { pharmacyId: parsedId });
      return res.status(404).json({ message: 'Pharmacy not found' });
    }
    console.log('Pharmacy fetched:', { pharmacyId: parsedId });
    res.status(200).json({ message: 'Pharmacy fetched successfully', pharmacy });
  } catch (error) {
    console.error('Fetch pharmacy error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Edit pharmacy
router.patch('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    const data = editPharmacySchema.parse(req.body);
    console.log('Editing pharmacy:', { pharmacyId: parsedId });
    const existingPharmacy = await prisma.pharmacy.findUnique({
      where: { id: parsedId },
    });
    if (!existingPharmacy) {
      console.error('Pharmacy not found:', { pharmacyId: parsedId });
      return res.status(404).json({ message: 'Pharmacy not found' });
    }
    if (data.licenseNumber !== existingPharmacy.licenseNumber) {
      const licenseConflict = await prisma.pharmacy.findUnique({
        where: { licenseNumber: data.licenseNumber },
      });
      if (licenseConflict) {
        console.error('License number already in use:', { licenseNumber: data.licenseNumber });
        return res.status(400).json({ message: 'License number already exists' });
      }
    }
    const addressString = `${data.address}, ${data.lga}, ${data.state}, Nigeria`;
    const geoResult = await geocoder.geocode(addressString);
    if (!geoResult.length) {
      console.error('Geocoding failed:', { address: addressString });
      return res.status(400).json({ message: 'Invalid address: unable to geocode' });
    }
    const { latitude, longitude } = geoResult[0];
    const updatedPharmacy = await prisma.$transaction(async (prisma) => {
      const pharmacy = await prisma.pharmacy.update({
        where: { id: parsedId },
        data: {
          name: data.name,
          address: data.address,
          lga: data.lga,
          state: data.state,
          phone: data.phone,
          licenseNumber: data.licenseNumber,
          status: data.status,
          logoUrl: data.logoUrl,
          isActive: data.isActive,
          verifiedAt: data.status === 'verified' ? new Date() : data.status === 'rejected' ? null : existingPharmacy.verifiedAt,
        },
      });
      await prisma.$queryRaw`
        UPDATE "Pharmacy"
        SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        WHERE id = ${parsedId}
      `;
      return pharmacy;
    });
    console.log('Pharmacy updated:', { pharmacyId: parsedId });
    res.status(200).json({
      message: 'Pharmacy updated successfully',
      pharmacy: {
        id: updatedPharmacy.id,
        name: updatedPharmacy.name,
        address: updatedPharmacy.address,
        lga: updatedPharmacy.lga,
        state: updatedPharmacy.state,
        phone: updatedPharmacy.phone,
        licenseNumber: updatedPharmacy.licenseNumber,
        status: updatedPharmacy.status,
        logoUrl: updatedPharmacy.logoUrl,
        isActive: updatedPharmacy.isActive,
        createdAt: updatedPharmacy.createdAt,
        verifiedAt: updatedPharmacy.verifiedAt,
      },
    });
  } catch (error) {
    console.error('Edit pharmacy error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete pharmacy
router.delete('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Deleting pharmacy:', { pharmacyId: parsedId });
    const existingPharmacy = await prisma.pharmacy.findUnique({
      where: { id: parsedId },
    });
    if (!existingPharmacy) {
      console.error('Pharmacy not found:', { pharmacyId: parsedId });
      return res.status(404).json({ message: 'Pharmacy not found' });
    }
    await prisma.pharmacy.delete({
      where: { id: parsedId },
    });
    console.log('Pharmacy deleted:', { pharmacyId: parsedId });
    res.status(200).json({ message: 'Pharmacy deleted successfully' });
  } catch (error) {
    console.error('Delete pharmacy error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all medications
router.get('/medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/medications');
    const { page, limit, name, genericName, category, prescriptionRequired, pharmacyId } = medicationFilterSchema
      .merge(z.object({ pharmacyId: z.string().regex(/^\d+$/).optional().transform(Number), prescriptionRequired: z.enum(['true', 'false']).optional().transform((val) =>
          val === 'true' ? true : val === 'false' ? false : undefined ), 
        })).parse(req.query);
    const skip = (page - 1) * limit;
    const where = {};
    if (name) where.name = { contains: name, mode: 'insensitive' };
    if (genericName) where.genericName = { contains: genericName, mode: 'insensitive' };
    if (category) where.category = { equals: category };
    if (prescriptionRequired !== undefined) {
      where.prescriptionRequired = prescriptionRequired;
    }
    if (pharmacyId) {
      where.pharmacyMedications = { some: { pharmacyId } };
    }
    const [medications, total] = await prisma.$transaction([
      prisma.medication.findMany({
        where,
        select: {
          id: true,
          name: true,
          genericName: true,
          category: true,
          description: true,
          manufacturer: true,
          form: true,
          dosage: true,
          nafdacCode: true,
          prescriptionRequired: true,
          imageUrl: true,
          createdAt: true,
          pharmacyMedications: {
            select: {
              stock: true,
              price: true,
              pharmacy: { select: { id: true, name: true } },
            },
          },
        },
        take: limit,
        skip,
      }),
      prisma.medication.count({ where }),
    ]);
    console.log('Medications fetched:', { count: medications.length, total });
    res.status(200).json({
      message: 'Medications fetched successfully',
      medications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Fetch medications error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single medication
router.get('/medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Received request for /api/admin/medications/:id', { medicationId: parsedId });
    const medication = await prisma.medication.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        name: true,
        genericName: true,
        category: true,
        description: true,
        manufacturer: true,
        form: true,
        dosage: true,
        nafdacCode: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        pharmacyMedications: {
          select: {
            stock: true,
            price: true,
            pharmacy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!medication) {
      console.error('Medication not found:', { medicationId: parsedId });
      return res.status(404).json({ message: 'Medication not found' });
    }
    console.log('Medication fetched:', { medicationId: parsedId });
    res.status(200).json({ message: 'Medication fetched successfully', medication });
  } catch (error) {
    console.error('Fetch medication error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create medication
router.post('/medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/medications (POST)', { body: req.body });
    const data = createMedicationSchema.parse(req.body);
    const medication = await prisma.medication.create({
      data: {
        ...data,
        createdAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        genericName: true,
        category: true,
        description: true,
        manufacturer: true,
        form: true,
        dosage: true,
        nafdacCode: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
      },
    });
    console.log('Medication created:', { medicationId: medication.id });
    res.status(201).json({ message: 'Medication created successfully', medication });
  } catch (error) {
    console.error('Create medication error:', {
      message: error.message,
      stack: error.stack,
    });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update medication
router.patch('/medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Received request for /api/admin/medications/:id (PATCH)', { medicationId: parsedId, body: req.body });
    const data = updateMedicationSchema.parse(req.body);
    const medication = await prisma.medication.update({
      where: { id: parsedId },
      data,
      select: {
        id: true,
        name: true,
        genericName: true,
        category: true,
        description: true,
        manufacturer: true,
        form: true,
        dosage: true,
        nafdacCode: true,
        prescriptionRequired: true,
        imageUrl: true,
        createdAt: true,
        pharmacyMedications: {
          select: {
            stock: true,
            price: true,
            pharmacy: { select: { id: true, name: true } },
          },
        },
      },
    });
    console.log('Medication updated:', { medicationId: parsedId });
    res.status(200).json({ message: 'Medication updated successfully', medication });
  } catch (error) {
    console.error('Update medication error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Medication not found' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete medication
router.delete('/medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Received request for /api/admin/medications/:id (DELETE)', { medicationId: parsedId });
    
    // Start a transaction to ensure atomicity
    await prisma.$transaction(async (prisma) => {
      // Delete related OrderItem records
      await prisma.orderItem.deleteMany({
        where: {
          pharmacyMedicationMedicationId: parsedId,
        },
      });
      // Delete related PharmacyMedication records
      await prisma.pharmacyMedication.deleteMany({
        where: { medicationId: parsedId },
      });
      // Delete the Medication
      await prisma.medication.delete({
        where: { id: parsedId },
      });
    });

    console.log('Medication, related PharmacyMedication, and OrderItem records deleted:', { medicationId: parsedId });
    res.status(200).json({ message: 'Medication deleted successfully' });
  } catch (error) {
    console.error('Delete medication error:', { message: error.message });
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Medication not found' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all prescriptions
router.get('/prescriptions', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/prescriptions');
    const { page, limit, status, patientIdentifier } = prescriptionFilterSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = {};
    if (status) where.status = status;
    if (patientIdentifier) where.patientIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
    const [prescriptions, total] = await prisma.$transaction([
      prisma.prescription.findMany({
        where,
        select: {
          id: true,
          patientIdentifier: true,
          fileUrl: true,
          status: true,
          verified: true,
          createdAt: true,
          orders: {
            select: {
              id: true,
              trackingCode: true,
              status: true,
              pharmacy: { select: { id: true, name: true } },
            },
          },
        },
        take: limit,
        skip,
      }),
      prisma.prescription.count({ where }),
    ]);
    console.log('Prescriptions fetched:', { count: prescriptions.length, total });
    res.status(200).json({
      message: 'Prescriptions fetched successfully',
      prescriptions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Fetch prescriptions error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single prescription
router.get('/prescriptions/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Received request for /api/admin/prescriptions/:id', { prescriptionId: parsedId });
    const prescription = await prisma.prescription.findUnique({
      where: { id: parsedId },
      include: {
        orders: {
          include: {
            pharmacy: true,
            items: {
              include: {
                pharmacyMedication: {
                  include: {
                    medication: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!prescription) {
      console.error('Prescription not found:', { prescriptionId: parsedId });
      return res.status(404).json({ message: 'Prescription not found' });
    }
    console.log('Prescription fetched:', { prescriptionId: parsedId });
    res.status(200).json({ message: 'Prescription fetched successfully', prescription });
  } catch (error) {
    console.error('Fetch prescription error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// Get all orders
router.get('/orders', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/orders');
    const { page, limit, status, patientIdentifier } = orderFilterSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = {};
    if (status) where.status = status;
    if (patientIdentifier) where.patientIdentifier = { contains: patientIdentifier, mode: 'insensitive' };
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        select: {
          id: true,
          patientIdentifier: true,
          status: true,
          totalPrice: true,
          createdAt: true,
        },
        take: limit,
        skip,
      }),
      prisma.order.count({ where }),
    ]);
    console.log('Orders fetched:', { count: orders.length, total });
    res.status(200).json({
      message: 'Orders fetched successfully',
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Fetch orders error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single order
router.get('/orders/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Received request for /api/admin/orders/:id', { orderId: parsedId });
    const order = await prisma.order.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        patientIdentifier: true,
        status: true,
        totalPrice: true,
        deliveryMethod: true,
        address: true,
        email: true,
        phone: true,
        trackingCode: true,
        filledAt: true,
        cancelledAt: true,
        cancelReason: true,
        paymentReference: true,
        paymentStatus: true,
        createdAt: true,
        updatedAt: true,
        pharmacy: {
          select: {
            id: true,
            name: true,
          },
        },
        prescription: {
          select: {
            id: true,
            patientIdentifier: true,
            status: true,
            fileUrl: true,
            verified: true,
          },
        },
        items: {
          select: {
            pharmacyMedication: {
              select: {
                medication: {
                  select: {
                    id: true,
                    name: true,
                    genericName: true,
                  },
                },
                pharmacy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            quantity: true,
            price: true,
          },
        },
      },
    });
    if (!order) {
      console.error('Order not found:', { orderId: parsedId });
      return res.status(404).json({ message: 'Order not found' });
    }
    console.log('Order fetched:', { orderId: parsedId });
    res.status(200).json({ message: 'Order fetched successfully', order });
  } catch (error) {
    console.error('Fetch order error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all admin users
router.get('/admin-users', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/admin-users');
    const { page, limit, role, email } = adminUserFilterSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = {};
    if (role) where.role = role;
    if (email) where.email = { contains: email, mode: 'insensitive' };
    const [users, total] = await prisma.$transaction([
      prisma.adminUser.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
        take: limit,
        skip,
      }),
      prisma.adminUser.count({ where }),
    ]);
    console.log('Admin users fetched:', { count: users.length, total });
    res.status(200).json({
      message: 'Admin users fetched successfully',
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Fetch admin users error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single admin user
router.get('/admin-users/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Received request for /api/admin/admin-users/:id', { userId: parsedId });
    const user = await prisma.adminUser.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user) {
      console.error('Admin user not found:', { userId: parsedId });
      return res.status(404).json({ message: 'Admin user not found' });
    }
    console.log('Admin user fetched:', { userId: parsedId });
    res.status(200).json({ message: 'Admin user fetched successfully', user });
  } catch (error) {
    console.error('Fetch admin user error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all pharmacy users
router.get('/pharmacy-users', authenticate, authenticateAdmin, async (req, res) => {
  try {
    console.log('Received request for /api/admin/pharmacy-users');
    const { page, limit, role, email, pharmacyId } = pharmacyUserFilterSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = {};
    if (role) where.role = role;
    if (email) where.email = { contains: email, mode: 'insensitive' };
    if (pharmacyId) where.pharmacyId = pharmacyId;
    const [users, total] = await prisma.$transaction([
      prisma.pharmacyUser.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          pharmacy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        take: limit,
        skip,
      }),
      prisma.pharmacyUser.count({ where }),
    ]);
    console.log('Pharmacy users fetched:', { count: users.length, total });
    res.status(200).json({
      message: 'Pharmacy users fetched successfully',
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Fetch pharmacy users error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single pharmacy user
router.get('/pharmacy-users/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id);
    console.log('Received request for /api/admin/pharmacy-users/:id', { userId: parsedId });
    const user = await prisma.pharmacyUser.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLogin: true,
        pharmacy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (!user) {
      console.error('Pharmacy user not found:', { userId: parsedId });
      return res.status(404).json({ message: 'Pharmacy user not found' });
    }
    console.log('Pharmacy user fetched:', { userId: parsedId });
    res.status(200).json({ message: 'Pharmacy user fetched successfully', user });
  } catch (error) {
    console.error('Fetch pharmacy user error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});



module.exports = router;