const express = require('express');
     const { PrismaClient } = require('@prisma/client');
     const router = express.Router();
     const prisma = new PrismaClient();
     router.get('/medications', async (req, res) => {
       try {
         const medication = await prisma.medication.findFirst();
         res.status(200).json({
           status: 'ok',
           database: 'connected',
           sampleMedication: medication || null,
         });
       } catch (error) {
         res.status(500).json({ status: 'error', message: error.message });
       }
     });
     router.get('/search', async (req, res) => {
       try {
         const { q } = req.query;
         if (!q || typeof q !== 'string' || q.trim().length === 0) {
           return res.status(400).json({ message: 'Search query is required' });
         }
         const searchTerm = `%${q.trim()}%`;
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
                 pharmacy: { select: { name: true } },
               },
             },
           },
         });
         const result = medications.map((med) => ({
           id: med.id,
           name: med.name,
           genericName: med.genericName,
           nafdacCode: med.nafdacCode,
           imageUrl: med.imageUrl,
           availability: med.pharmacyMedications.map((pm) => ({
             pharmacyId: pm.pharmacyId,
             pharmacyName: pm.pharmacy.name,
             stock: pm.stock,
             price: pm.price,
           })),
         }));
         res.status(200).json(result);
       } catch (error) {
         res.status(500).json({ message: 'Server error', error: error.message });
       }
     });
     module.exports = router;