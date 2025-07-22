const express = require('express');
const z = require('zod');
const adminService = require('../services/adminService');
const { editPharmacySchema, paginationSchema, createMedicationSchema, updateMedicationSchema, medicationFilterSchema, prescriptionFilterSchema, orderFilterSchema, adminUserFilterSchema, pharmacyUserFilterSchema, categorySchema, therapeuticClassSchema, chemicalClassSchema, manufacturerSchema, genericMedicationSchema, indicationSchema } = require('../utils/adminValidation');
const { authenticate, authenticateAdmin } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded admin.js version: 2025-07-15-v3 (new schema)');

// GET /admin/dashboard - Dashboard overview
router.get('/dashboard', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const summary = await adminService.getDashboardOverview();
    res.status(200).json({ message: 'Dashboard data fetched successfully', summary });
  } catch (error) {
    console.error('Fetch dashboard error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/pharmacies - Get all pharmacies
router.get('/pharmacies', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = {
      ...paginationSchema.parse(req.query),
      status: req.query.status,
      state: req.query.state,
      name: req.query.name,
    };
    const { pharmacies, pagination } = await adminService.getPharmacies(query);
    res.status(200).json({
      message: 'Pharmacies fetched successfully',
      pharmacies,
      pagination,
    });
  } catch (error) {
    console.error('Fetch pharmacies error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/pharmacies/simple - Get pharmacies for filter dropdown
router.get('/pharmacies/simple', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const simplePharmacies = await adminService.getSimplePharmacies();
    res.status(200).json({ message: 'Pharmacies fetched successfully', simplePharmacies });
  } catch (error) {
    console.error('Fetch pharmacies error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/pharmacies/:id - Get single pharmacy
router.get('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid pharmacy ID' });
    }
    const pharmacy = await adminService.getPharmacy(Number(id));
    res.status(200).json({ message: 'Pharmacy fetched successfully', pharmacy });
  } catch (error) {
    console.error('Fetch pharmacy error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Pharmacy not found' : 'Server error', error: error.message });
  }
});

// PATCH /admin/pharmacies/:id - Edit pharmacy
router.patch('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid pharmacy ID' });
    }
    // Convert status to UPPERCASE for new schema
    const data = { ...editPharmacySchema.parse(req.body), status: req.body.status?.toUpperCase() };
    const pharmacy = await adminService.updatePharmacy(Number(id), data);
    res.status(200).json({ message: 'Pharmacy updated successfully', pharmacy });
  } catch (error) {
    console.error('Edit pharmacy error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 404 || error.status === 400 ? error.status : 500).json({ message: error.message, error: error.message });
  }
});

// DELETE /admin/pharmacies/:id - Delete pharmacy
router.delete('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid pharmacy ID' });
    }
    await adminService.deletePharmacy(Number(id));
    res.status(200).json({ message: 'Pharmacy deleted successfully' });
  } catch (error) {
    console.error('Delete pharmacy error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Pharmacy not found' : 'Server error', error: error.message });
  }
});


// GET /admin/medications - Get all medications
router.get('/medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = medicationFilterSchema.parse(req.query);
    const { medications, pagination } = await adminService.getMedications(query);
    res.status(200).json({ message: 'Medications fetched successfully', medications, pagination });
  } catch (error) {
    console.error('Fetch medications error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/medications/:id - Get single medication
router.get('/medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid medication ID' });
    }
    const medication = await adminService.getMedication(Number(id));
    res.status(200).json({ message: 'Medication fetched successfully', medication });
  } catch (error) {
    console.error('Fetch medication error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Medication not found' : 'Server error', error: error.message });
  }
});

// POST /admin/medications - Create medication
router.post('/medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    // Expect new schema fields
    const data = createMedicationSchema.parse(req.body);
    const medication = await adminService.createMedication(data);
    res.status(201).json({ message: 'Medication created successfully', medication });
  } catch (error) {
    console.error('Create medication error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /admin/medications/:id - Update medication
router.patch('/medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid medication ID' });
    }
    // Expect new schema fields
    const data = updateMedicationSchema.parse(req.body);
    const medication = await adminService.updateMedication(Number(id), data);
    res.status(200).json({ message: 'Medication updated successfully', medication });
  } catch (error) {
    console.error('Update medication error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Medication not found' : 'Server error', error: error.message });
  }
});

// DELETE /admin/medications/:id - Delete medication
router.delete('/medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid medication ID' });
    }
    await adminService.deleteMedication(Number(id));
    res.status(200).json({ message: 'Medication deleted successfully' });
  } catch (error) {
    console.error('Delete medication error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Medication not found' : 'Server error', error: error.message });
  }
});


// GET /admin/prescriptions - Get all prescriptions
router.get('/prescriptions', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = prescriptionFilterSchema.parse(req.query);
    const { prescriptions, pagination } = await adminService.getPrescriptions(query);
    res.status(200).json({ message: 'Prescriptions fetched successfully', prescriptions, pagination });
  } catch (error) {
    console.error('Fetch prescriptions error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/prescriptions/:id - Get single prescription
router.get('/prescriptions/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid prescription ID' });
    }
    const prescription = await adminService.getPrescription(Number(id));
    res.status(200).json({ message: 'Prescription fetched successfully', prescription });
  } catch (error) {
    console.error('Fetch prescription error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Prescription not found' : 'Server error', error: error.message });
  }
});

// GET /admin/orders - Get all orders
router.get('/orders', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = orderFilterSchema.parse(req.query);
    const { orders, pagination } = await adminService.getOrders(query);
    res.status(200).json({ message: 'Orders fetched successfully', orders, pagination });
  } catch (error) {
    console.error('Fetch orders error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/orders/:id - Get single order
router.get('/orders/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }
    const order = await adminService.getOrder(Number(id));
    res.status(200).json({ message: 'Order fetched successfully', order });
  } catch (error) {
    console.error('Fetch order error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Order not found' : 'Server error', error: error.message });
  }
});


// GET /admin/admin-users - Get all admin users
router.get('/admin-users', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = adminUserFilterSchema.parse(req.query);
    const { users, pagination } = await adminService.getAdminUsers(query);
    res.status(200).json({ message: 'Admin users fetched successfully', users, pagination });
  } catch (error) {
    console.error('Fetch admin users error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/admin-users/:id - Get single admin user
router.get('/admin-users/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid admin user ID' });
    }
    const user = await adminService.getAdminUser(Number(id));
    res.status(200).json({ message: 'Admin user fetched successfully', user });
  } catch (error) {
    console.error('Fetch admin user error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Admin user not found' : 'Server error', error: error.message });
  }
});

// GET /admin/pharmacy-users - Get all pharmacy users
router.get('/pharmacy-users', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = pharmacyUserFilterSchema.parse(req.query);
    const { users, pagination } = await adminService.getPharmacyUsers(query);
    res.status(200).json({ message: 'Pharmacy users fetched successfully', users, pagination });
  } catch (error) {
    console.error('Fetch pharmacy users error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/pharmacy-users/:id - Get single pharmacy user
router.get('/pharmacy-users/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid pharmacy user ID' });
    }
    const user = await adminService.getPharmacyUser(Number(id));
    res.status(200).json({ message: 'Pharmacy user fetched successfully', user });
  } catch (error) {
    console.error('Fetch pharmacy user error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Pharmacy user not found' : 'Server error', error: error.message });
  }
});

// --- CATEGORY ROUTES ---
router.get('/categories', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { categories, pagination } = await adminService.getCategories(req.query);
    res.status(200).json({ message: 'Categories fetched successfully', categories, pagination });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.get('/categories/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const category = await adminService.getCategory(Number(req.params.id));
    res.status(200).json({ message: 'Category fetched successfully', category });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.post('/categories', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = categorySchema.parse(req.body);
    const category = await adminService.createCategory(data);
    res.status(201).json({ message: 'Category created successfully', category });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.patch('/categories/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = categorySchema.parse(req.body);
    const category = await adminService.updateCategory(Number(req.params.id), data);
    res.status(200).json({ message: 'Category updated successfully', category });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.delete('/categories/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    await adminService.deleteCategory(Number(req.params.id));
    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});

// --- THERAPEUTIC CLASS ROUTES ---
router.get('/therapeutic-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { therapeuticClasses, pagination } = await adminService.getTherapeuticClasses(req.query);
    res.status(200).json({ message: 'Therapeutic classes fetched successfully', therapeuticClasses, pagination });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.get('/therapeutic-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const therapeuticClass = await adminService.getTherapeuticClass(Number(req.params.id));
    res.status(200).json({ message: 'Therapeutic class fetched successfully', therapeuticClass });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.post('/therapeutic-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = therapeuticClassSchema.parse(req.body);
    const therapeuticClass = await adminService.createTherapeuticClass(data);
    res.status(201).json({ message: 'Therapeutic class created successfully', therapeuticClass });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.patch('/therapeutic-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = therapeuticClassSchema.parse(req.body);
    const therapeuticClass = await adminService.updateTherapeuticClass(Number(req.params.id), data);
    res.status(200).json({ message: 'Therapeutic class updated successfully', therapeuticClass });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.delete('/therapeutic-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    await adminService.deleteTherapeuticClass(Number(req.params.id));
    res.status(200).json({ message: 'Therapeutic class deleted successfully' });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});

// --- CHEMICAL CLASS ROUTES ---
router.get('/chemical-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { chemicalClasses, pagination } = await adminService.getChemicalClasses(req.query);
    res.status(200).json({ message: 'Chemical classes fetched successfully', chemicalClasses, pagination });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.get('/chemical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const chemicalClass = await adminService.getChemicalClass(Number(req.params.id));
    res.status(200).json({ message: 'Chemical class fetched successfully', chemicalClass });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.post('/chemical-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = chemicalClassSchema.parse(req.body);
    const chemicalClass = await adminService.createChemicalClass(data);
    res.status(201).json({ message: 'Chemical class created successfully', chemicalClass });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.patch('/chemical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = chemicalClassSchema.parse(req.body);
    const chemicalClass = await adminService.updateChemicalClass(Number(req.params.id), data);
    res.status(200).json({ message: 'Chemical class updated successfully', chemicalClass });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.delete('/chemical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    await adminService.deleteChemicalClass(Number(req.params.id));
    res.status(200).json({ message: 'Chemical class deleted successfully' });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});

// --- MANUFACTURER ROUTES ---
router.get('/manufacturers', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { manufacturers, pagination } = await adminService.getManufacturers(req.query);
    res.status(200).json({ message: 'Manufacturers fetched successfully', manufacturers, pagination });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.get('/manufacturers/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const manufacturer = await adminService.getManufacturer(Number(req.params.id));
    res.status(200).json({ message: 'Manufacturer fetched successfully', manufacturer });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.post('/manufacturers', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = manufacturerSchema.parse(req.body);
    const manufacturer = await adminService.createManufacturer(data);
    res.status(201).json({ message: 'Manufacturer created successfully', manufacturer });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.patch('/manufacturers/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = manufacturerSchema.parse(req.body);
    const manufacturer = await adminService.updateManufacturer(Number(req.params.id), data);
    res.status(200).json({ message: 'Manufacturer updated successfully', manufacturer });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.delete('/manufacturers/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    await adminService.deleteManufacturer(Number(req.params.id));
    res.status(200).json({ message: 'Manufacturer deleted successfully' });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});

// --- GENERIC MEDICATION ROUTES ---
router.get('/generic-medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { genericMedications, pagination } = await adminService.getGenericMedications(req.query);
    res.status(200).json({ message: 'Generic medications fetched successfully', genericMedications, pagination });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.get('/generic-medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const genericMedication = await adminService.getGenericMedication(Number(req.params.id));
    res.status(200).json({ message: 'Generic medication fetched successfully', genericMedication });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.post('/generic-medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = genericMedicationSchema.parse(req.body);
    const genericMedication = await adminService.createGenericMedication(data);
    res.status(201).json({ message: 'Generic medication created successfully', genericMedication });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.patch('/generic-medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = genericMedicationSchema.parse(req.body);
    const genericMedication = await adminService.updateGenericMedication(Number(req.params.id), data);
    res.status(200).json({ message: 'Generic medication updated successfully', genericMedication });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.delete('/generic-medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    await adminService.deleteGenericMedication(Number(req.params.id));
    res.status(200).json({ message: 'Generic medication deleted successfully' });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});

// --- INDICATION ROUTES ---
router.get('/indications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { indications, pagination } = await adminService.getIndications(req.query);
    res.status(200).json({ message: 'Indications fetched successfully', indications, pagination });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.get('/indications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const indication = await adminService.getIndication(Number(req.params.id));
    res.status(200).json({ message: 'Indication fetched successfully', indication });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.post('/indications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = indicationSchema.parse(req.body);
    const indication = await adminService.createIndication(data);
    res.status(201).json({ message: 'Indication created successfully', indication });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.patch('/indications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = indicationSchema.parse(req.body);
    const indication = await adminService.updateIndication(Number(req.params.id), data);
    res.status(200).json({ message: 'Indication updated successfully', indication });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: error.errors });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});
router.delete('/indications/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    await adminService.deleteIndication(Number(req.params.id));
    res.status(200).json({ message: 'Indication deleted successfully' });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message });
  }
});

module.exports = router;