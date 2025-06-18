const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  try {
    const { trackingCode } = req.query;
    if (!trackingCode) {
      console.error('Missing tracking code');
      return res.status(400).json({ message: 'Tracking code required' });
    }

    if (!/^TRK-SESSION-\d+-\d+$/.test(trackingCode)) {
      console.error('Invalid tracking code format:', { trackingCode });
      return res.status(400).json({ message: 'Invalid tracking code format' });
    }

    console.log('Searching for orders by tracking code:', { trackingCode });
    const orders = await prisma.order.findMany({
      where: {
        trackingCode,
        status: {
          in: ['confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled'],
        },
      },
      select: {
        id: true,
        patientIdentifier: true,
        totalPrice: true,
        address: true,
        deliveryMethod: true,
        trackingCode: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        updatedAt: true,
        filledAt: true,
        cancelledAt: true,
        cancelReason: true,
        prescriptionId: true,
        prescription: {
          select: {
            id: true,
            status: true,
            fileUrl: true,
            verified: true,
            createdAt: true,
            PrescriptionMedication: {
              select: {
                medicationId: true,
                quantity: true,
                Medication: {
                  select: { name: true, genericName: true, dosage: true },
                },
              },
            },
          },
        },
        pharmacy: {
          select: { id: true, name: true, address: true },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            price: true,
            pharmacyMedication: {
              select: {
                medication: {
                  select: { id: true, name: true, genericName: true, dosage: true, prescriptionRequired: true },
                },
                pharmacy: {
                  select: { name: true, address: true },
                },
                receivedDate: true,
                expiryDate: true,
              },
            },
          },
        },
      },
    });

    if (orders.length === 0) {
      console.error('Orders not found for tracking code:', { trackingCode });
      return res.status(404).json({ message: 'Orders not found or not ready for tracking' });
    }

    console.log('Orders found:', { orderIds: orders.map(o => o.id), trackingCode, status: orders.map(o => o.status) });

    res.status(200).json({
      message: 'Orders found',
      orders: orders.map(order => ({
        id: order.id,
        patientIdentifier: order.patientIdentifier,
        totalPrice: order.totalPrice,
        address: order.address,
        deliveryMethod: order.deliveryMethod,
        trackingCode: order.trackingCode,
        status: order.status,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        filledAt: order.filledAt,
        cancelledAt: order.cancelledAt,
        cancelReason: order.cancelReason,
        prescription: order.prescription ? {
          id: order.prescription.id,
          status: order.prescription.status,
          fileUrl: order.prescription.fileUrl,
          verified: order.prescription.verified,
          createdAt: order.prescription.createdAt,
          medications: order.prescription.PrescriptionMedication.map(pm => ({
            medicationId: pm.medicationId,
            name: pm.Medication.name,
            genericName: pm.Medication.genericName,
            dosage: pm.Medication.dosage,
            quantity: pm.quantity,
          })),
        } : null,
        pharmacy: {
          id: order.pharmacy.id,
          name: order.pharmacy.name,
          address: order.pharmacy.address,
        },
        items: order.items.map(item => ({
          id: item.id,
          medication: {
            id: item.pharmacyMedication.medication.id,
            name: item.pharmacyMedication.medication.name,
            genericName: item.pharmacyMedication.medication.genericName,
            dosage: item.pharmacyMedication.medication.dosage,
            prescriptionRequired: item.pharmacyMedication.medication.prescriptionRequired,
          },
          pharmacy: {
            name: item.pharmacyMedication.pharmacy.name,
            address: item.pharmacyMedication.pharmacy.address,
          },
          quantity: item.quantity,
          price: item.price,
          receivedDate: item.pharmacyMedication.receivedDate,
          expiryDate: item.pharmacyMedication.expiryDate,
        })),
      })),
    });
  } catch (error) {
    console.error('Track error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;