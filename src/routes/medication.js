const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/medications', async (req, res) => {
  try {
    const medication = await prisma.medication.findFirst({
      select: { id: true, name: true, genericName: true, nafdacCode: true, imageUrl: true },
    });
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      sampleMedication: medication || null,
    });
  } catch (error) {
    console.error('Error fetching medication:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch medication data' });
  }
});
 
router.get('/search', async (req, res) => {
  try {
    const { q, page = '1', limit = '10' } = req.query;
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ message: 'Search query is required' });
    }
    const searchTerm = `%${q.trim()}%`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const medications = await prisma.medication.findMany({
      where: {
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { genericName: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      include: {
        pharmacyMedications: {
          select: {
            stock: true,
            price: true,
            pharmacyId: true,
            receivedDate: true,
            expiryDate: true,
            pharmacy: { select: { name: true } },
          },
        },
      },
      take: limitNum,
      skip,
    });

    const result = medications.map((med) => ({
      id: med.id,
      name: med.name,
      genericName: med.genericName,
      description: med.description,
      manufacturer: med.manufacturer,
      form: med.form,
      dosage: med.dosage,
      nafdacCode: med.nafdacCode,
      imageUrl: med.imageUrl,
      availability: med.pharmacyMedications.map((pm) => ({
        pharmacyId: pm.pharmacyId,
        pharmacyName: pm.pharmacy.name,
        stock: pm.stock,
        price: pm.price,
        receivedDate: pm.receivedDate,
        expiryDate: pm.expiryDate,
      })),
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('Error searching medications:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;