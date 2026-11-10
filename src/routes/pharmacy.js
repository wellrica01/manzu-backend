const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt'); // ADD THIS
const prisma = new PrismaClient();
const pharmacyOrdersService = require('../domains/pharmacy/orders/pharmacy-orders.service');
const pharmacyMedicationsService = require('../domains/pharmacy/medications/pharmacy-medications.service');
const pharmacyUsersService = require('../domains/pharmacy/users/pharmacy-users.service');
const pharmacyProfileService = require('../domains/pharmacy/profile/pharmacy-profile.service');
const pharmacyDashboardService = require('../domains/pharmacy/dashboard/pharmacy-dashboard.service');
const pharmacySalesService = require('../domains/pharmacy/sales/pharmacy-sales.service');
const pharmacyBankingService = require('../domains/pharmacy/banking/pharmacy-banking.service');
const pharmacyPayoutsService = require('../domains/pharmacy/payouts/pharmacy-payouts.service');
const pharmacyPushService = require('../domains/pharmacy/push/push.service');
const { validateRegisterPushToken, validatePushTokenParam } = require('../domains/pharmacy/push/push.validation');
const { validateFetchOrders, validateUpdateOrder, 
  validateFetchMedications, validateAddMedication, validateBulkUpdateOrders, validateUpdateMedication, 
  validateDeleteMedication, validateFetchUsers, validateRegisterDevice, validateOrderId } = require('../utils/validation');
const { authenticatePharmacy, authorizeRoles } = require('../middleware/auth');
const router = express.Router();
const supabase = require('../utils/supabaseClient')

const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');


// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

console.log('Loaded pharmacy.js version: 2025-06-19-v3 (deep linking support)');






// ======================
// BANKING ROUTES
// ======================

// GET /pharmacy/banking/banks - Get list of Nigerian banks
router.get('/banking/banks', authenticatePharmacy, async (req, res) => {
  try {
    const banks = await pharmacyBankingService.getNigerianBanks();
    res.status(200).json({ banks });
  } catch (error) {
    console.error('Fetch banks error:', error);
    res.status(500).json({ message: 'Failed to fetch banks', error: error.message });
  }
});

// GET /pharmacy/banking/status - Check banking setup status
router.get('/banking/status', authenticatePharmacy, async (req, res) => {
  try {
    const status = await pharmacyBankingService.getBankingStatus(req.user.pharmacyId);
    res.status(200).json(status);
  } catch (error) {
    console.error('Banking status error:', error);
    res.status(500).json({ message: 'Failed to fetch banking status', error: error.message });
  }
});

// POST /pharmacy/banking/setup - Setup bank account
router.post('/banking/setup', authenticatePharmacy, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { accountNumber, bankCode, bankName } = req.body;

    if (!accountNumber || !bankCode || !bankName) {
      return res.status(400).json({ 
        message: 'Account number, bank code, and bank name are required' 
      });
    }

    const result = await pharmacyBankingService.setupBankAccount(
      req.user.pharmacyId,
      { accountNumber, bankCode, bankName }
    );

    res.status(200).json(result);
  } catch (error) {
    console.error('Banking setup error:', error);
    
    if (error.message.includes('already configured')) {
      return res.status(400).json({ message: error.message });
    }
    
    res.status(500).json({ 
      message: 'Failed to setup banking', 
      error: error.message 
    });
  }
});

// PUT /pharmacy/banking/update - Update bank account
router.put('/banking/update', authenticatePharmacy, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { accountNumber, bankCode, bankName } = req.body;

    if (!accountNumber || !bankCode || !bankName) {
      return res.status(400).json({ 
        message: 'Account number, bank code, and bank name are required' 
      });
    }

    const result = await pharmacyBankingService.updateBankAccount(
      req.user.pharmacyId,
      { accountNumber, bankCode, bankName }
    );

    res.status(200).json(result);
  } catch (error) {
    console.error('Banking update error:', error);
    res.status(500).json({ 
      message: 'Failed to update banking', 
      error: error.message 
    });
  }
});

// POST /pharmacy/banking/verify - Verify bank account (before saving)
router.post('/banking/verify', authenticatePharmacy, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || !bankCode) {
      return res.status(400).json({ 
        message: 'Account number and bank code are required' 
      });
    }

    const verification = await pharmacyBankingService.verifyBankAccount(
      accountNumber,
      bankCode
    );

    if (verification.success) {
      res.status(200).json({
        message: 'Account verified successfully',
        accountName: verification.accountName,
        accountNumber: verification.accountNumber,
      });
    } else {
      res.status(400).json({
        message: verification.error || 'Account verification failed',
      });
    }
  } catch (error) {
    console.error('Bank verification error:', error);
    res.status(500).json({ 
      message: 'Failed to verify account', 
      error: error.message 
    });
  }
});

// ======================
// PAYOUT ROUTES
// ======================

// GET /pharmacy/payouts/summary - Get payout summary
router.get('/payouts/summary', authenticatePharmacy, async (req, res) => {
  try {
    const summary = await pharmacyPayoutsService.getPayoutSummary(req.user.pharmacyId);
    res.status(200).json({
      message: 'Payout summary fetched',
      ...summary,
    });
  } catch (error) {
    console.error('Payout summary error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch payout summary', 
      error: error.message 
    });
  }
});

// GET /pharmacy/payouts/history - Get payout history
router.get('/payouts/history', authenticatePharmacy, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await pharmacyPayoutsService.getPayoutHistory(
      req.user.pharmacyId,
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.status(200).json({
      message: 'Payout history fetched',
      ...result,
    });
  } catch (error) {
    console.error('Payout history error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch payout history', 
      error: error.message 
    });
  }
});

// GET /pharmacy/orders/pending-payout - Get orders awaiting payout
router.get('/orders/pending-payout', authenticatePharmacy, async (req, res) => {
  try {
    const orders = await pharmacyPayoutsService.getOrdersPendingPayout(req.user.pharmacyId);
    
    // Calculate totals
    const totalAmount = orders.reduce((sum, order) => sum + (order.pharmacyAmount || 0), 0);
    const totalOrders = orders.length;

    res.status(200).json({
      message: 'Pending payout orders fetched',
      orders,
      summary: {
        totalOrders,
        totalAmount,
      },
    });
  } catch (error) {
    console.error('Pending payout orders error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch pending payout orders', 
      error: error.message 
    });
  }
});

// GET /pharmacy/earnings/analytics - Get earnings analytics
router.get('/earnings/analytics', authenticatePharmacy, async (req, res) => {
  try {
    const { period = 'week' } = req.query; // week, month, year

    let startDate = new Date();
    
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    // Get completed orders in period
    const completedOrders = await prisma.order.findMany({
      where: {
        pharmacyId: req.user.pharmacyId,
        status: 'COMPLETED',
        filledAt: {
          gte: startDate,
        },
      },
      select: {
        pharmacyAmount: true,
        totalPrice: true,
        platformFee: true,
        filledAt: true,
      },
    });

    // Get completed payouts in period
    const completedPayouts = await prisma.payout.findMany({
      where: {
        pharmacyId: req.user.pharmacyId,
        status: 'COMPLETED',
        completedAt: {
          gte: startDate,
        },
      },
    });

    const totalEarnings = completedOrders.reduce(
      (sum, order) => sum + (order.pharmacyAmount || 0), 
      0
    );

    const totalPaid = completedPayouts.reduce(
      (sum, payout) => sum + parseFloat(payout.amount), 
      0
    );

    const pendingPayout = totalEarnings - totalPaid;

    res.status(200).json({
      message: 'Earnings analytics fetched',
      period,
      totalEarnings,
      totalPaid,
      pendingPayout,
      orderCount: completedOrders.length,
      payoutCount: completedPayouts.length,
    });
  } catch (error) {
    console.error('Earnings analytics error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch earnings analytics', 
      error: error.message 
    });
  }
});



// POST /pharmacy/profile/logo - Upload pharmacy logo
router.post('/profile/logo', 
  authenticatePharmacy, 
  authorizeRoles('MANAGER'), 
  upload.single('logo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No logo file provided' });
      }

      const { pharmacyId } = req.user;
      const file = req.file;
      
      // Generate unique filename
      const fileExt = file.originalname.split('.').pop();
      const fileName = `pharmacy-logos/${pharmacyId}-${Date.now()}.${fileExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('pharmacy-assets') // Your bucket name
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true
        });

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        throw new Error('Failed to upload logo to storage');
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('pharmacy-assets')
        .getPublicUrl(fileName);

      // Get old logo URL to delete later
      const pharmacy = await prisma.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: { logoUrl: true }
      });

      // Update pharmacy with new logo URL
      await prisma.pharmacy.update({
        where: { id: pharmacyId },
        data: { logoUrl: publicUrl }
      });

      // Delete old logo if exists
      if (pharmacy.logoUrl) {
        const oldFileName = pharmacy.logoUrl.split('/').pop();
        await supabase.storage
          .from('pharmacy-assets')
          .remove([`pharmacy-logos/${oldFileName}`]);
      }

      res.status(200).json({
        message: 'Logo updated successfully',
        logoUrl: publicUrl
      });

    } catch (error) {
      console.error('Logo upload error:', error);
      res.status(500).json({ 
        message: 'Failed to upload logo', 
        error: error.message 
      });
    }
  }
);


// GET /pharmacy/orders - Fetch orders for pharmacy (new schema)
router.get('/orders', authenticatePharmacy, async (req, res) => {
  try {
    const { error, value } = validateFetchOrders(req.query);
    if (error) {
      console.error('Validation error:', error.details.map(d => d.message).join(', '));
      return res.status(400).json({ 
        message: 'Invalid query parameters', 
        errors: error.details.map(d => d.message) 
      });
    }

    const result = await pharmacyOrdersService.fetchOrders(req.user.pharmacyId, {
      page: value.page,
      limit: value.limit,
      search: value.search,
      status: value.status,
      date: value.date,
      deliveryMethod: value.deliveryMethod,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Pharmacy orders error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});



// PATCH /pharmacy/orders/bulk - Bulk update order statuses
router.patch('/orders/bulk', authenticatePharmacy, async (req, res) => {
  try {
    const { orderIds, status, cancelReason } = req.body;

    // Validate input
    const { error } = validateBulkUpdateOrders({ orderIds, status, cancelReason });
    if (error) {
      console.error('Validation error:', error.details.map(d => d.message).join(', '));
      return res.status(400).json({ 
        message: 'Invalid bulk update data',
        errors: error.details.map(d => d.message)
      });
    }

    const results = await pharmacyOrdersService.bulkUpdateOrderStatus(
      orderIds, 
      status, 
      req.user.pharmacyId,
      cancelReason
    );

    res.status(200).json({
      message: `Bulk update completed: ${results.successful.length} updated, ${results.failed.length} failed`,
      results
    });
  } catch (error) {
    console.error('Bulk order update error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});



router.get('/orders/:orderId', authenticatePharmacy, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Validate orderId
    const { error } = validateOrderId({ orderId: Number(orderId) });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ 
        message: 'Invalid order ID', 
        error: error.message 
      });
    }
    
    // Fetch order using service
    const order = await pharmacyOrdersService.fetchOrderById(
      req.user.pharmacyId, 
      Number(orderId)
    );
    
    res.status(200).json(order);
  } catch (error) {
    console.error('Fetch single order error:', { message: error.message, stack: error.stack });
    
    // Handle 404 specifically
    if (error.status === 404) {
      return res.status(404).json({ 
        message: error.message 
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to fetch order', 
      error: error.message 
    });
  }
});


// PATCH /pharmacy/orders/:orderId - Update order status
router.patch('/orders/:orderId', authenticatePharmacy, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, cancelReason } = req.body;

    const { error } = validateUpdateOrder({ orderId, status, cancelReason });
    if (error) {
      return res.status(400).json({
        message: error.message,
        errors: error.details.map(d => d.message),
      });
    }

    const updatedOrder = await pharmacyOrdersService.updateOrderStatus(
      Number(orderId),
      status,
      req.user.pharmacyId,
      cancelReason
    );
    res.status(200).json({ message: 'Order status updated', order: updatedOrder });
  } catch (error) {
    if (error.code === 'INVALID_STATUS_TRANSITION') {
      return res.status(400).json({ message: error.message, error: 'INVALID_STATUS_TRANSITION' });
    }
    if (error.code === 'STATUS_UNCHANGED') {
      return res.status(409).json({ message: error.message, error: 'STATUS_UNCHANGED' });
    }
    if (error.code === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ message: error.message, error: 'ORDER_NOT_FOUND' });
    }
    console.error('Order update error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// GET /pharmacy/medications/catalog - NEW unified endpoint
router.get('/medications/catalog', authenticatePharmacy, async (req, res) => {
  try {
    const { error, value } = validateFetchMedications(req.query);
    if (error) {
      console.error('Validation error:', error.details.map(d => d.message).join(', '));
      return res.status(400).json({ 
        message: 'Invalid query parameters', 
        errors: error.details.map(d => d.message) 
      });
    }

    const result = await pharmacyMedicationsService.fetchMedicationCatalog(req.user.pharmacyId, {
      page: value.page,
      limit: value.limit,
      search: value.search,
      status: value.status, // 'all', 'stocked', 'not_stocked', 'low_stock', 'out_of_stock', 'expiring_soon'
      prescriptionRequired: value.prescriptionRequired,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Pharmacy medication catalog error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/medications - Keep for backward compatibility
router.get('/medications', authenticatePharmacy, async (req, res) => {
  try {
    const { error, value } = validateFetchMedications(req.query);
    if (error) {
      console.error('Validation error:', error.details.map(d => d.message).join(', '));
      return res.status(400).json({ 
        message: 'Invalid query parameters', 
        errors: error.details.map(d => d.message) 
      });
    }

    // Use new catalog endpoint
    const result = await pharmacyMedicationsService.fetchMedicationCatalog(req.user.pharmacyId, {
      page: value.page,
      limit: value.limit,
      search: value.search,
      status: value.lowStock ? 'low_stock' : 
              value.outOfStock ? 'out_of_stock' : 
              value.expiringSoon ? 'expiring_soon' : 'stocked',
      prescriptionRequired: value.prescriptionRequired,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Pharmacy medications error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/medications - Simplified (now upserts)
router.post('/medications', authenticatePharmacy, async (req, res) => {
  try {
    const { medicationId, stock, price, receivedDate, expiryDate, batchNumber } = req.body;

    const { error } = validateAddMedication({ medicationId, stock, price, batchNumber });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const medication = await pharmacyMedicationsService.updateOrCreateMedication({
      pharmacyId: req.user.pharmacyId,
      medicationId: Number(medicationId),
      stock: Number(stock),
      price: parseFloat(Number(price).toFixed(2)),
      receivedDate,
      expiryDate,
      batchNumber,
    });
    
    res.status(200).json({ 
      message: 'Inventory updated successfully', 
      medication 
    });
  } catch (error) {
    console.error('Update medication error:', { message: error.message, stack: error.stack });
    
    if (error.message.includes('cannot stock this medication')) {
      return res.status(403).json({ message: error.message });
    }
    
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH /pharmacy/medications/:medicationId - Now also uses upsert
router.patch('/medications/:medicationId', authenticatePharmacy, async (req, res) => {
  try {
    const { medicationId } = req.params;
    const { stock, price, receivedDate, expiryDate, batchNumber } = req.body;
    
    const { error } = validateUpdateMedication({ medicationId, stock, price, receivedDate, expiryDate, batchNumber });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const updatedMedication = await pharmacyMedicationsService.updateOrCreateMedication({
      pharmacyId: req.user.pharmacyId,
      medicationId: Number(medicationId),
      stock: Number(stock),
      price: parseFloat(Number(price).toFixed(2)),
      receivedDate,
      expiryDate,
      batchNumber,
    });
    
    res.status(200).json({ 
      message: 'Inventory updated successfully', 
      medication: updatedMedication 
    });
  } catch (error) {
    console.error('Update medication error:', error);
    
    if (error.message.includes('cannot stock this medication')) {
      return res.status(403).json({ message: error.message });
    }
    
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE remains the same
router.delete('/medications/:medicationId', authenticatePharmacy, async (req, res) => {
  try {
    const { medicationId } = req.params;

    const { error } = validateDeleteMedication({ medicationId });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    await pharmacyMedicationsService.deleteMedication(req.user.pharmacyId, Number(medicationId));
    res.status(200).json({ message: 'Medication removed from inventory' });
  } catch (error) {
    console.error('Delete medication error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// GET /pharmacy/users - Fetch pharmacy users (manager only)
router.get('/users', authenticatePharmacy, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    // Validate input (no query params to validate)
    const { error } = validateFetchUsers({});
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const users = await pharmacyUsersService.fetchUsers(req.user.pharmacyId);
    res.status(200).json({ message: 'Users fetched', users });
  } catch (error) {
    console.error('Fetch users error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/notifications/register - Device registration for notifications (new schema)
router.post('/notifications/register', authenticatePharmacy, async (req, res) => {
  try {
    const { deviceToken } = req.body;

    // Validate input
    const { error } = validateRegisterDevice({ deviceToken });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    await pharmacyProfileService.registerDevice(req.user.pharmacyId, deviceToken);
    res.status(200).json({ message: 'Device registered for notifications' });
  } catch (error) {
    console.error('Device registration error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/push-tokens - Register this device for push (one row per device)
router.post('/push-tokens', authenticatePharmacy, async (req, res) => {
  try {
    const { error, value } = validateRegisterPushToken(req.body);
    if (error) {
      return res.status(400).json({ message: error.message });
    }
    const { userId, pharmacyId } = req.user;
    await pharmacyPushService.registerToken({ userId, pharmacyId, token: value.token, platform: value.platform });
    res.status(200).json({ message: 'Push token registered' });
  } catch (error) {
    // Never log the token itself.
    console.error('Push token register error:', { message: error.message });
    res.status(error.status === 400 ? 400 : 500).json({ message: error.status === 400 ? error.message : 'Server error' });
  }
});

// DELETE /pharmacy/push-tokens/:token - Unregister this device (call on logout; the token must be URL-encoded)
router.delete('/push-tokens/:token', authenticatePharmacy, async (req, res) => {
  try {
    const { error, value } = validatePushTokenParam({ token: req.params.token });
    if (error) {
      return res.status(400).json({ message: error.message });
    }
    const { userId, pharmacyId } = req.user;
    await pharmacyPushService.unregisterToken({ userId, pharmacyId, token: value.token });
    res.status(200).json({ message: 'Push token removed' });
  } catch (error) {
    console.error('Push token delete error:', { message: error.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /pharmacy/profile - Get pharmacy profile details (new schema)
router.get('/profile', authenticatePharmacy, async (req, res) => {
  try {
    const { userId, pharmacyId } = req.user;
    const { user, pharmacy } = await pharmacyProfileService.getProfile(userId, pharmacyId);
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
router.patch('/profile', authenticatePharmacy, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { user, pharmacy } = require('../utils/adminValidation').editProfileSchema.parse(req.body);
    const { userId, pharmacyId } = req.user;
    const { updatedUser, updatedPharmacy } = await pharmacyProfileService.editProfile({ user, pharmacy }, userId, pharmacyId);
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


// GET /pharmacy/operating-hours - Get operating hours
router.get('/operating-hours', authenticatePharmacy, async (req, res) => {
  try {
    const operatingHours = await prisma.operatingHour.findMany({
      where: { pharmacyId: req.user.pharmacyId },
      orderBy: { dayOfWeek: 'asc' }
    });
    
    // Format times for frontend - extract UTC time portion
    const formatted = operatingHours.map(h => ({
      dayOfWeek: h.dayOfWeek,
      openTime: h.openTime 
        ? new Date(h.openTime).toISOString().slice(11, 16)
        : null,
      closeTime: h.closeTime 
        ? new Date(h.closeTime).toISOString().slice(11, 16)
        : null
    }));
    
    res.status(200).json({ operatingHours: formatted });
  } catch (error) {
    console.error('Fetch operating hours error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/operating-hours - Set operating hours
router.post('/operating-hours', authenticatePharmacy, authorizeRoles('MANAGER'), async (req, res) => {
  try {
    const { hours } = req.body;
    
    if (!Array.isArray(hours) || hours.length === 0) {
      return res.status(400).json({ message: 'Invalid hours data' });
    }

    await prisma.$transaction(async (prisma) => {
      // Delete existing hours
      await prisma.operatingHour.deleteMany({
        where: { pharmacyId: req.user.pharmacyId }
      });

      // Only create entries for days that are open
      const openDays = hours.filter(h => !h.isClosed);
      
      if (openDays.length > 0) {
        await prisma.operatingHour.createMany({
          data: openDays.map(h => ({
            pharmacyId: req.user.pharmacyId,
            dayOfWeek: h.dayOfWeek,
            // Store times directly as time strings, avoiding Date conversion
            openTime: new Date(`1970-01-01T${h.openTime}:00Z`),
            closeTime: new Date(`1970-01-01T${h.closeTime}:00Z`),
          }))
        });
      }
    });

    const updatedHours = await prisma.operatingHour.findMany({
      where: { pharmacyId: req.user.pharmacyId },
      orderBy: { dayOfWeek: 'asc' }
    });

    res.status(200).json({ 
      message: 'Operating hours updated successfully',
      operatingHours: updatedHours 
    });
  } catch (error) {
    console.error('Update operating hours error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// GET /pharmacy/dashboard - Dashboard summary for pharmacy 
router.get('/dashboard', authenticatePharmacy, async (req, res) => {
  try {
    const data = await pharmacyDashboardService.getDashboardData(req.user.pharmacyId);
    res.status(200).json({ message: 'Dashboard data fetched', ...data });
  } catch (error) {
    console.error('Dashboard error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /pharmacy/analytics/weekly - Weekly analytics
router.get('/analytics/weekly', authenticatePharmacy, async (req, res) => {
  try {
    const data = await pharmacyDashboardService.getWeeklyAnalytics(req.user.pharmacyId);
    res.status(200).json({ message: 'Weekly analytics fetched', ...data });
  } catch (error) {
    console.error('Analytics error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /pharmacy/sales - Record a new PoS sale (new schema)
router.post('/sales', authenticatePharmacy, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !Array.isArray(items) || !total || !paymentMethod) {
      return res.status(400).json({ message: 'Invalid sale data' });
    }
    const sale = await pharmacySalesService.recordSale({
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


// GET /pharmacy/sales - Fetch sales with pagination and filters
router.get('/sales', authenticatePharmacy, async (req, res) => {
  try {
    const { 
      date, startDate, endDate, paymentMethod, minAmount, maxAmount,
      page = 1, limit = 20
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
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [sales, total, allSales] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.sale.count({ where }),
      prisma.sale.findMany({ where, select: { total: true, paymentMethod: true } })
    ]);
    
    const stats = {
      totalRevenue: allSales.reduce((sum, s) => sum + s.total, 0),
      cashSales: allSales.filter(s => s.paymentMethod === 'CASH').length,
      cardSales: allSales.filter(s => s.paymentMethod === 'CARD').length,
    };
    
    res.status(200).json({ 
      message: 'Sales fetched', 
      sales,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats
    });
  } catch (error) {
    console.error('Fetch sales error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});



// New export endpoint
router.get('/sales/export', authenticatePharmacy, async (req, res) => {
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


// POST /pharmacy/change-password - Removed: it wrote an 8+ char password over the PIN hash and locked users out of PIN login.
router.post('/change-password', authenticatePharmacy, (req, res) => {
  res.status(410).json({ error: 'GONE', message: 'Use PATCH /api/auth/change-password with { currentPin, newPin }' });
});



module.exports = router;