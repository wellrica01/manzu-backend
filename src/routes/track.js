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
    // Validate trackingCode format (e.g., TRK followed by digits)
if (!/^TRK-\d+-\d+$/.test(trackingCode)) {
    console.error('Invalid tracking code format:', { trackingCode });
    return res.status(400).json({ message: 'Invalid tracking code format' });
}
    console.log('Searching for order by tracking code:', { trackingCode });
const order = await prisma.order.findFirst({
    where: { trackingCode },
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
    pharmacy: {
        select: { name: true, address: true },
    },
    items: {
        select: {
        id: true,
        quantity: true,
        price: true,
        pharmacyMedication: {
            select: {
            medication: {
                select: { name: true, genericName: true, dosage: true },
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
    if (!order) {
        console.error('Order not found for tracking code:', { trackingCode });
        return res.status(404).json({ message: 'Order not found' });
    }
    console.log('Order found:', { orderId: order.id, trackingCode, status: order.status });
res.status(200).json({
    message: 'Order found',
    order: {
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
    pharmacy: {
        name: order.pharmacy.name,
        address: order.pharmacy.address,
    },
    items: order.items.map(item => ({
        id: item.id,
        medication: {
        name: item.pharmacyMedication.medication.name,
        genericName: item.pharmacyMedication.medication.genericName,
        dosage: item.pharmacyMedication.medication.dosage,
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
    },
});
    } catch (error) {
    console.error('Track error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
    }
});
module.exports = router;