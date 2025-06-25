const express = require('express');
const z = require('zod');
const adminService = require('../services/adminService');
const { editProviderSchema, paginationSchema, createServiceSchema, updateServiceSchema, serviceFilterSchema, prescriptionFilterSchema, orderFilterSchema, adminUserFilterSchema, providerUserFilterSchema } = require('../utils/adminValidation');
const { authenticate, authenticateAdmin } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded admin.js version: 2025-06-25-v2');

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

// GET /admin/providers - Get all providers
router.get('/providers', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = paginationSchema.parse(req.query);
    const { providers, pagination } = await adminService.getProviders(query);
    res.status(200).json({
      message: 'Providers fetched successfully',
      providers,
      pagination,
    });
  } catch (error) {
    console.error('Fetch providers error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/providers/simple - Get providers for filter dropdown
router.get('/providers/simple', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const simpleProviders = await adminService.getSimpleProviders();
    res.status(200).json({ message: 'Providers fetched successfully', simpleProviders });
  } catch (error) {
    console.error('Fetch providers error:', { message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/providers/:id - Get single provider
router.get('/providers/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid provider ID' });
    }
    const provider = await adminService.getProvider(Number(id));
    res.status(200).json({ message: 'Provider fetched successfully', provider });
  } catch (error) {
    console.error('Fetch provider error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Provider not found' : 'Server error', error: error.message });
  }
});

// PATCH /admin/providers/:id - Edit provider
router.patch('/providers/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid provider ID' });
    }
    const data = editProviderSchema.parse(req.body);
    const provider = await adminService.updateProvider(Number(id), data);
    res.status(200).json({ message: 'Provider updated successfully', provider });
  } catch (error) {
    console.error('Edit provider error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 404 || error.status === 400 ? error.status : 500).json({ message: error.message, error: error.message });
  }
});

// DELETE /admin/providers/:id - Delete provider
router.delete('/providers/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid provider ID' });
    }
    await adminService.deleteProvider(Number(id));
    res.status(200).json({ message: 'Provider deleted successfully' });
  } catch (error) {
    console.error('Delete provider error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Provider not found' : 'Server error', error: error.message });
  }
});

// GET /admin/services - Get all services
router.get('/services', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = serviceFilterSchema.parse(req.query);
    const { services, pagination } = await adminService.getServices(query);
    res.status(200).json({ message: 'Services fetched successfully', services, pagination });
  } catch (error) {
    console.error('Fetch services error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/services/:id - Get single service
router.get('/services/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }
    const service = await adminService.getService(Number(id));
    res.status(200).json({ message: 'Service fetched successfully', service });
  } catch (error) {
    console.error('Fetch service error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Service not found' : 'Server error', error: error.message });
  }
});

// POST /admin/services - Create service
router.post('/services', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = createServiceSchema.parse(req.body);
    const service = await adminService.createService(data);
    res.status(201).json({ message: 'Service created successfully', service });
  } catch (error) {
    console.error('Create service error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /admin/services/:id - Update service
router.patch('/services/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }
    const data = updateServiceSchema.parse(req.body);
    const service = await adminService.updateService(Number(id), data);
    res.status(200).json({ message: 'Service updated successfully', service });
  } catch (error) {
    console.error('Update service error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Service not found' : 'Server error', error: error.message });
  }
});

// DELETE /admin/services/:id - Delete service
router.delete('/services/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }
    await adminService.deleteService(Number(id));
    res.status(200).json({ message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Delete service error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Service not found' : 'Server error', error: error.message });
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

// GET /admin/provider-users - Get all provider users
router.get('/provider-users', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = providerUserFilterSchema.parse(req.query);
    const { users, pagination } = await adminService.getProviderUsers(query);
    res.status(200).json({ message: 'Provider users fetched successfully', users, pagination });
  } catch (error) {
    console.error('Fetch provider users error:', { message: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /admin/provider-users/:id - Get single provider user
router.get('/provider-users/:id', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid provider user ID' });
    }
    const user = await adminService.getProviderUser(Number(id));
    res.status(200).json({ message: 'Provider user fetched successfully', user });
  } catch (error) {
    console.error('Fetch provider user error:', { message: error.message });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.status === 404 ? 'Provider user not found' : 'Server error', error: error.message });
  }
});

module.exports = router;