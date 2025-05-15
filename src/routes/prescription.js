const express = require('express');
     const multer = require('multer');
     const { PrismaClient } = require('@prisma/client');
     const path = require('path');
     const router = express.Router();
     const prisma = new PrismaClient();
     const storage = multer.diskStorage({
       destination: (req, file, cb) => {
         cb(null, 'uploads/');
       },
       filename: (req, file, cb) => {
         const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
         cb(null, `prescription-${uniqueSuffix}${path.extname(file.originalname)}`);
       },
     });
     const upload = multer({
       storage,
       fileFilter: (req, file, cb) => {
         const filetypes = /pdf|jpg|jpeg|png/;
         const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
         const mimetype = filetypes.test(file.mimetype);
         if (extname && mimetype) {
           return cb(null, true);
         }
         cb(new Error('Only PDF, JPG, JPEG, and PNG files are allowed'));
       },
     });
     router.post('/upload', upload.single('prescriptionFile'), async (req, res) => {
       try {
         if (!req.file) {
           return res.status(400).json({ message: 'No file uploaded' });
         }
         const { patientIdentifier } = req.body;
         if (!patientIdentifier || typeof patientIdentifier !== 'string' || patientIdentifier.trim().length === 0) {
           return res.status(400).json({ message: 'Valid patient identifier is required' });
         }
         const prescription = await prisma.prescription.create({
           data: {
             patientIdentifier: patientIdentifier.trim(),
             fileUrl: `/uploads/${req.file.filename}`,
             status: 'pending',
             verified: false,
           },
         });
         res.status(201).json({ message: 'Prescription uploaded successfully', prescription });
       } catch (error) {
         res.status(500).json({ message: 'Server error', error: error.message });
       }
     });
     module.exports = router;