const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pharmacyService = require('../services/pharmacyService');   
const { validateFetchOrders, validateUpdateOrder, validateFetchMedications, validateAddMedication, validateUpdateMedication, validateDeleteMedication, validateFetchUsers, validateRegisterDevice } = require('../utils/validation');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded pharmacy.js version: 2025-06-19-v2 (new schema)');

// GET /pharmacy/orders - Fetch orders for pharmacy (new schema)
router.get('/orders', authenticate, async (req, res) => {
  try {
    const { error, value } = validateFetchOrders(req.query);
    if (error) {
      console.error('Validation error:', error.details.map(d => d.message).join(', '));
      return res.status(400).json({ 
        message: 'Invalid query parameters', 
        errors: error.details.map(d => d.message) 
      });
    }

    const result = await pharmacyService.fetchOrders(req.user.pharmacyId, {
      page: value.page,
      limit: value.limit,
      search: value.search,
      status: value.status,
      date: value.date, // Added
      deliveryMethod: value.deliveryMethod, // Added
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Pharmacy orders error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /pharmacy/orders/:orderId - Update order status (new schema)
router.patch('/orders/:orderId', authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    // Validate input
    const { error } = validateUpdateOrder({ orderId, status });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedOrder = await pharmacyService.updateOrderStatus(Number(orderId), status, req.user.pharmacyId);
    res.status(200).json({ message: 'Order status updated', order: updatedOrder });
  } catch (error) {
    console.error('Order update error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/medications - Fetch pharmacy medications (new schema)
router.get('/medications', authenticate, async (req, res) => {
  try {
    // Validate query parameters
    const { error, value } = validateFetchMedications(req.query);
    if (error) {
      console.error('Validation error:', error.details.map(d => d.message).join(', '));
      return res.status(400).json({ message: 'Invalid query parameters', error: error.details.map(d => d.message) });
    }

    // Pass validated query params and pharmacyId to fetchMedications
    const result = await pharmacyService.fetchMedications(req.user.pharmacyId, {
      page: value.page,
      limit: value.limit,
      search: value.search,
      lowStock: value.lowStock,
      outOfStock: value.outOfStock,
      prescriptionRequired: value.prescriptionRequired,
    });

    // Return result directly to match frontend expectation
    res.status(200).json(result);
  } catch (error) {
    console.error('Pharmacy medications error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// POST /pharmacy/medications - Add new pharmacy medication (new schema)
router.post('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId, stock, price, receivedDate, expiryDate, batchNumber } = req.body;

    // Validate input
    const { error } = validateAddMedication({ medicationId, stock, price, batchNumber });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const medication = await pharmacyService.addMedication({
      pharmacyId: req.user.pharmacyId,
      medicationId: Number(medicationId),
      stock: Number(stock),
      price: parseFloat(Number(price).toFixed(2)),
      receivedDate,
      expiryDate,
      batchNumber,
    });
    res.status(201).json({ message: 'Medication added', medication });
  } catch (error) {
    console.error('Add medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /pharmacy/medications - Update pharmacy medication (new schema)
router.patch('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId, stock, price, receivedDate, expiryDate, batchNumber } = req.body;
    // Validate input
    const { error } = validateUpdateMedication({ medicationId, stock, price, receivedDate, expiryDate, batchNumber });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const updatedMedication = await pharmacyService.updateMedication({
      pharmacyId: req.user.pharmacyId,
      medicationId: Number(medicationId),
      stock: Number(stock),
      price: parseFloat(Number(price).toFixed(2)),
      receivedDate,
      expiryDate,
      batchNumber,
    });
    res.status(200).json({ message: 'Medication updated', medication: updatedMedication });
  } catch (error) {
    console.error('Update medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE /pharmacy/medications - Delete pharmacy medication (new schema)
router.delete('/medications', authenticate, async (req, res) => {
  try {
    const { medicationId } = req.query;

    // Validate input
    const { error } = validateDeleteMedication({ medicationId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await pharmacyService.deleteMedication(req.user.pharmacyId, Number(medicationId));
    res.status(200).json({ message: 'Medication deleted' });
  } catch (error) {
    console.error('Delete medication error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/users - Fetch pharmacy users (manager only)
router.get('/users', authenticate, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    // Validate input (no query params to validate)
    const { error } = validateFetchUsers({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const users = await pharmacyService.fetchUsers(req.user.pharmacyId);
    res.status(200).json({ message: 'Users fetched', users });
  } catch (error) {
    console.error('Fetch users error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/notifications/register - Device registration for notifications (new schema)
router.post('/notifications/register', authenticate, async (req, res) => {
  try {
    const { deviceToken } = req.body;

    // Validate input
    const { error } = validateRegisterDevice({ deviceToken });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await pharmacyService.registerDevice(req.user.pharmacyId, deviceToken);
    res.status(200).json({ message: 'Device registered for notifications' });
  } catch (error) {
    console.error('Device registration error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/profile - Get pharmacy profile details (new schema)
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { userId, pharmacyId } = req.user;
    const { user, pharmacy } = await pharmacyService.getProfile(userId, pharmacyId);
    res.status(200).json({
      message: 'Profile fetched successfully',
      user,
      pharmacy,
    });
  } catch (error) {
    console.error('Fetch profile error:', { message: error.message, stack: error.stack });
    res.status(error.status === 404 ? 404 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// PATCH /pharmacy/profile - Edit pharmacy profile (manager only, new schema)
router.patch('/profile', authenticate, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { user, pharmacy } = require('../utils/adminValidation').editProfileSchema.parse(req.body);
    const { userId, pharmacyId } = req.user;
    const { updatedUser, updatedPharmacy } = await pharmacyService.editProfile({ user, pharmacy }, userId, pharmacyId);
    res.status(200).json({
      message: 'Profile updated successfully',
      user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role },
      pharmacy: {
        id: updatedPharmacy.id,
        name: updatedPharmacy.name,
        address: updatedPharmacy.address,
        lga: updatedPharmacy.lga,
        state: updatedPharmacy.state,
        ward: updatedPharmacy.ward,
        phone: updatedPharmacy.phone,
        licenseNumber: updatedPharmacy.licenseNumber,
        logoUrl: updatedPharmacy.logoUrl,
      },
    });
  } catch (error) {
    console.error('Edit profile error:', { message: error.message, stack: error.stack });
    if (error instanceof require('zod').ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 ? 400 : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

// GET /pharmacy/dashboard - Dashboard summary for pharmacy (new schema)
// Now includes PoS (walk-in) sales stats: posSalesToday, posRevenueToday
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const data = await pharmacyService.getDashboardData(req.user.pharmacyId);
    res.status(200).json({ message: 'Dashboard data fetched', ...data });
  } catch (error) {
    console.error('Dashboard error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/analytics/weekly - Weekly analytics
router.get('/analytics/weekly', authenticate, async (req, res) => {
  try {
    const data = await pharmacyService.getWeeklyAnalytics(req.user.pharmacyId);
    res.status(200).json({ message: 'Weekly analytics fetched', ...data });
  } catch (error) {
    console.error('Analytics error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/sales - Record a new PoS sale (new schema)
router.post('/sales', authenticate, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !Array.isArray(items) || !total || !paymentMethod) {
      return res.status(400).json({ message: 'Invalid sale data' });
    }
    const sale = await pharmacyService.recordSale({
      pharmacyId: req.user.pharmacyId,
      items,
      total,
      paymentMethod,
    });
    res.status(201).json({ message: 'Sale recorded', sale });
  } catch (error) {
    console.error('Record sale error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/sales?date=YYYY-MM-DD - Fetch sales for a day (new schema)
router.get('/sales', authenticate, async (req, res) => {
  try {
    const { 
      date, 
      startDate, 
      endDate, 
      paymentMethod, 
      minAmount, 
      maxAmount 
    } = req.query;
    
    let where = { pharmacyId: req.user.pharmacyId };
    
    // Date filtering
    if (date) {
       const start = new Date(date + 'T00:00:00.000Z');
      const end = new Date(date + 'T23:59:59.999Z');
      where.createdAt = { gte: start, lte: end };
    } else if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate + 'T00:00:00.000Z'),
        lte: new Date(endDate + 'T23:59:59.999Z')
      };
    }
    
    // Payment method filter
    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }
    
    // Amount range filter
    if (minAmount || maxAmount) {
      where.total = {};
      if (minAmount) where.total.gte = parseFloat(minAmount);
      if (maxAmount) where.total.lte = parseFloat(maxAmount);
    }
    
    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    
    res.status(200).json({ message: 'Sales fetched', sales });
  } catch (error) {
    console.error('Fetch sales error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// New export endpoint
router.get('/sales/export', authenticate, async (req, res) => {
  try {
    const { date, startDate, endDate, paymentMethod } = req.query;
    
    let where = { pharmacyId: req.user.pharmacyId };
    
    if (date) {
      const start = new Date(date + 'T00:00:00.000Z');
      const end = new Date(date + 'T23:59:59.999Z');
      where.createdAt = { gte: start, lte: end };
    } else if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate + 'T00:00:00.000Z'),
        lte: new Date(endDate + 'T23:59:59.999Z')
      };
    }
    
    if (paymentMethod) where.paymentMethod = paymentMethod;
    
    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    
    // Generate CSV
    const csvRows = [];
    csvRows.push('Transaction ID,Date,Time,Items Count,Total Amount,Payment Method');
    
    sales.forEach(sale => {
      const date = new Date(sale.createdAt);
      const itemsCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
      csvRows.push([
        sale.id,
        date.toLocaleDateString(),
        date.toLocaleTimeString(),
        itemsCount,
        sale.total,
        sale.paymentMethod
      ].join(','));
    });
    
    const csvContent = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=sales-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export sales error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;