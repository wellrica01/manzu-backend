const { PrismaClient } = require('@prisma/client');
const { sendPrescriptionExpiryNotification } = require('../utils/notifications');

const prisma = new PrismaClient();

const logger = {
  info: console.log,
  error: console.error,
};

/**
 * Expire prescriptions that have passed their expiry date
 */
async function expirePrescriptions() {
  try {
    const now = new Date();
    
    // Find prescriptions that need to be expired
    const expiredPrescriptions = await prisma.prescription.findMany({
      where: {
        status: 'VERIFIED',
        expiryDate: { lte: now }
      },
      include: {
        Order: {
          where: {
            status: { in: ['PENDING_PRESCRIPTION', 'CART'] }
          }
        }
      }
    });

    if (expiredPrescriptions.length === 0) {
      logger.info('No prescriptions to expire');
      return;
    }

    // Update prescriptions to EXPIRED status
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.prescription.updateMany({
        where: {
          status: 'VERIFIED',
          expiryDate: { lte: now }
        },
        data: {
          status: 'EXPIRED',
          updatedAt: new Date()
        }
      });

      // Update associated orders back to CART status
      for (const prescription of expiredPrescriptions) {
        if (prescription.Order && prescription.Order.length > 0) {
          await tx.order.updateMany({
            where: {
              prescriptionId: prescription.id,
              status: { in: ['PENDING', 'PENDING_PRESCRIPTION'] }
            },
            data: {
              status: 'CART',
              prescriptionId: null,
              updatedAt: new Date()
            }
          });
        }
      }

      return updated;
    });

    logger.info('Prescriptions expired:', { 
      expiredCount: result.count,
      prescriptionIds: expiredPrescriptions.map(p => p.id)
    });

    // Send notifications to users
    for (const prescription of expiredPrescriptions) {
      try {
        await sendPrescriptionExpiryNotification(prescription);
      } catch (error) {
        logger.error('Failed to send expiry notification:', { 
          prescriptionId: prescription.id,
          error: error.message 
        });
      }
    }

    return result;
  } catch (error) {
    logger.error('Prescription expiry job failed:', { message: error.message });
    throw error;
  }
}

/**
 * Send expiry warnings for prescriptions expiring soon (3 days before)
 */
async function sendExpiryWarnings() {
  try {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    
    const now = new Date();

    const expiringPrescriptions = await prisma.prescription.findMany({
      where: {
        status: 'VERIFIED',
        expiryDate: {
          gte: now,
          lte: threeDaysFromNow
        }
      }
    });

    logger.info('Prescriptions expiring soon:', { count: expiringPrescriptions.length });

    for (const prescription of expiringPrescriptions) {
      try {
        await sendPrescriptionExpiryNotification(prescription, true); // true = warning
      } catch (error) {
        logger.error('Failed to send expiry warning:', { 
          prescriptionId: prescription.id,
          error: error.message 
        });
      }
    }

    return expiringPrescriptions;
  } catch (error) {
    logger.error('Expiry warning job failed:', { message: error.message });
    throw error;
  }
}

module.exports = {
  expirePrescriptions,
  sendExpiryWarnings
};