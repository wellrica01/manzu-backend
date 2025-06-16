const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const authenticate = require('./admin');
const prisma = new PrismaClient();


router.post('/notifications/register', authenticate, async (req, res) => {
  try {
    const { deviceToken, pharmacyId } = req.body;
    if (!deviceToken || !pharmacyId) {
      return res.status(400).json({ message: 'Device token and pharmacy ID required' });
    }
    await prisma.pharmacy.update({
      where: { id: parseInt(pharmacyId) },
      data: { deviceToken },
    });
    console.log('Device token registered:', { pharmacyId });
    res.status(200).json({ message: 'Device registered for notifications' });
  } catch (error) {
    console.error('Device registration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;