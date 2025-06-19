const express = require('express');
const notificationService = require('../services/notificationService');
const { registerDeviceSchema } = require('../utils/notificationValidation');
const { authenticate, authenticateManager } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded notifications.js version: 2025-06-19-v1');

// POST /notifications/register - Register device for notifications
router.post('/register', authenticate, authenticateManager, async (req, res) => {
  try {
    const { deviceToken, pharmacyId } = registerDeviceSchema.parse(req.body);
    const userId = req.user.userId;
    await notificationService.registerDevice(deviceToken, pharmacyId, userId);
    res.status(200).json({ message: 'Device registered for notifications' });
  } catch (error) {
    console.error('Device registration error:', { message: error.message, userId: req.user?.userId, pharmacyId: req.body?.pharmacyId });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(error.status === 400 || error.status === 404 ? error.status : 500).json({ message: error.message || 'Server error', error: error.message });
  }
});

module.exports = router;