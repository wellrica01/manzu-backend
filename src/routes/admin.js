const express = require('express');
const z = require('zod');
const adminService = require('../services/adminService');
const { editPharmacySchema, paginationSchema, createMedicationSchema, updateMedicationSchema, medicationFilterSchema, prescriptionFilterSchema, orderFilterSchema, adminUserFilterSchema, pharmacyUserFilterSchema } = require('../utils/adminValidation');
const { authenticate, authenticateAdmin } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded admin.js version: 2025-06-19-v1');

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
    const query = paginationSchema.parse(req.query);
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
    const data = editPharmacySchema.parse(req.body);
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

module.exports = router;