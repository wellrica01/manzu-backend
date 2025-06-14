const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const router = express.Router();
const prisma = new PrismaClient();

// Validation schema
const consentSchema = z.object({
  patientIdentifier: z.string().optional(),
  userId: z.number().optional(),
  consentType: z.enum(['data_collection', 'marketing']),
  granted: z.boolean(),
}).refine(data => data.patientIdentifier || data.userId, {
  message: 'Patient identifier or user ID required',
});

// Record consent
router.post('/', async (req, res) => {
  try {
    const data = consentSchema.parse(req.body);
    const consent = await prisma.consent.upsert({
      where: {
        patientidentifier_consenttype: {
          patientidentifier: data.patientIdentifier || '',
          consenttype: data.consentType,
        },
      },
      update: {
        granted: data.granted,
        createdat: new Date(),
      },
      create: {
        patientidentifier: data.patientIdentifier,
        userid: data.userId,
        consenttype: data.consentType,
        granted: data.granted,
        createdat: new Date(),
      },
    });
    res.status(201).json({ message: 'Consent recorded', consent });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid input', errors: error.errors });
    }
    console.error('Consent error:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


module.exports = router;