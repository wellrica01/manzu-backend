/**
 * ADMIN PRESCRIPTIONS REPOSITORY
 * 
 * Database access layer for admin prescription management
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find prescriptions with filters and pagination
 */
async function findPrescriptions({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.prescription.findMany({
      where,
      select: {
        id: true,
        userIdentifier: true,
        fileUrl: true,
        status: true,
        createdAt: true,
        Order: {
          select: {
            id: true,
            trackingCode: true,
            status: true,
            Pharmacy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip,
    }),
    prisma.prescription.count({ where }),
  ]);
}

/**
 * Find prescription by ID with full details
 */
async function findPrescriptionById(id) {
  return await prisma.prescription.findUnique({
    where: { id },
    include: {
      PrescriptionMedication: {
        include: { 
          Medication: {
            select: {
              id: true,
              brandName: true,
              fullName: true,
              brandDescription: true,
            }
          }
        },
      },
      Order: {
        include: {
          Pharmacy: {
            select: {
              id: true,
              name: true,
            },
          },
          OrderItem: {
            include: {
              MedicationAvailability: {
                include: { Medication: true },
              },
            },
          },
        },
      },
    },
  });
}

module.exports = {
  findPrescriptions,
  findPrescriptionById,
};