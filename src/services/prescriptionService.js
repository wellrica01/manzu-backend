const { PrismaClient } = require('@prisma/client');
const { normalizePhone } = require('../utils/validation');
const { sendVerificationNotification } = require('../utils/notifications');
const { formatServiceDisplayName } = require('../utils/serviceUtils');
const prisma = new PrismaClient();

async function uploadPrescription({ patientIdentifier, email, phone, fileUrl, orderId, itemIds, type, crossService }) {
  if (!patientIdentifier || !fileUrl || !orderId) {
    throw new Error('Patient identifier, file URL, and order ID are required');
  }

  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const order = await prisma.order.findUnique({
    where: { id: Number(orderId), patientIdentifier },
    include: { items: { include: { service: true } } },
  });
  if (!order) {
    throw new Error('Order not found');
  }

  const validItemIds = order.items
    .filter((item) => item.service.prescriptionRequired && (crossService || item.service.type === type))
    .map((item) => item.id);
  const selectedItemIds = itemIds.filter((id) => validItemIds.includes(Number(id)));

  if (!crossService && !selectedItemIds.length) {
    throw new Error('No valid items selected for this prescription');
  }

  const prescription = await prisma.$transaction(async (tx) => {
    const createdPrescription = await tx.prescription.create({
      data: {
        patientIdentifier,
        email,
        phone: normalizedPhone,
        fileUrl,
        status: 'pending',
        verified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        orders: { connect: { id: Number(orderId) } },
      },
    });

    if (selectedItemIds.length) {
      await tx.prescriptionOrderItem.createMany({
        data: selectedItemIds.map((itemId) => ({
          prescriptionId: createdPrescription.id,
          orderItemId: Number(itemId),
          createdAt: new Date(),
        })),
      });
    } else if (crossService) {
      await tx.prescriptionOrderItem.createMany({
        data: validItemIds.map((itemId) => ({
          prescriptionId: createdPrescription.id,
          orderItemId: itemId,
          createdAt: new Date(),
        })),
      });
    }

    await tx.order.update({
      where: { id: Number(orderId) },
      data: { status: 'pending_prescription' },
    });

    return createdPrescription;
  });

  console.log('Prescription uploaded:', { prescriptionId: prescription.id, itemIds: selectedItemIds });
  return prescription;
}

async function addServices(prescriptionId, services) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
  });
  if (!prescription) {
    throw new Error('Prescription not found');
  }
  if (prescription.status !== 'pending') {
    throw new Error('Prescription is already processed');
  }

  const result = await prisma.$transaction(async (tx) => {
    const prescriptionServices = [];
    for (const service of services) {
      const { serviceId, quantity } = service;
      const serviceRecord = await tx.service.findUnique({
        where: { id: Number(serviceId) },
      });
      if (!serviceRecord) {
        throw new Error(`Service ${serviceId} not found`);
      }
      const prescriptionService = await tx.prescriptionService.create({
        data: {
          prescriptionId,
          serviceId: Number(serviceId),
          quantity: quantity || 1, // Default to 1 for diagnostics
        },
      });
      prescriptionServices.push(prescriptionService);
    }
    return { prescriptionServices };
  });

  console.log('Services added:', { prescriptionId, services: result.prescriptionServices });
  return result;
}

async function verifyPrescription(prescriptionId, status, rejectReason) {
  if (!prescriptionId || isNaN(parseInt(prescriptionId))) {
    throw new Error('Invalid prescription ID');
  }
  if (!['pending', 'verified', 'rejected'].includes(status)) {
    throw new Error('Invalid status value');
  }
  if (status === 'rejected' && !rejectReason) {
    throw new Error('Reject reason is required for rejected status');
  }

  const prescription = await prisma.prescription.findUnique({
    where: { id: parseInt(prescriptionId) },
    include: {
      orders: {
        include: {
          provider: true,
          items: {
            include: {
              providerService: {
                include: { service: true },
              },
            },
          },
        },
      },
      orderItems: true,
    },
  });
  if (!prescription) {
    throw new Error('Prescription not found');
  }
  if (prescription.status !== 'pending') {
    throw new Error('Prescription is already processed');
  }

  const updatedPrescription = await prisma.$transaction(async (tx) => {
    const prescriptionUpdate = await tx.prescription.update({
      where: { id: parseInt(prescriptionId) },
      data: {
        status,
        verified: status === 'verified',
        rejectReason: status === 'rejected' ? rejectReason : null,
        updatedAt: new Date(),
      },
    });

    if (prescription.orders && prescription.orders.length > 0) {
      if (status === 'rejected') {
        for (const order of prescription.orders) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'cancelled',
              cancelReason: 'Prescription rejected',
              cancelledAt: new Date(),
            },
          });

          for (const item of order.items) {
            if (item.providerService.service.type === 'medication') {
              await tx.providerService.update({
                where: {
                  providerId_serviceId: {
                    providerId: item.providerId,
                    serviceId: item.serviceId,
                  },
                },
                data: {
                  stock: { increment: item.quantity },
                },
              });
            }
          }
        }
      } else if (status === 'verified') {
        for (const order of prescription.orders) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'confirmed',
            },
          });
        }
      }
    }

    return prescriptionUpdate;
  });

  if (prescription.orders && prescription.orders.length > 0) {
    for (const order of prescription.orders) {
      await sendVerificationNotification(updatedPrescription, status, order);
    }
  }

  console.log('Prescription updated:', { prescriptionId: updatedPrescription.id, status });
  return updatedPrescription;
}

async function getGuestOrder({ patientIdentifier, lat, lng, radius }) {
  if (!patientIdentifier) {
    throw new Error('Patient identifier is required');
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radiusKm = parseFloat(radius) || 10;
  const hasValidCoordinates = lat && lng && !isNaN(userLat) && !isNaN(userLng) && !isNaN(radiusKm);

  if (hasValidCoordinates && (userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180)) {
    throw new Error('Invalid latitude or longitude');
  }

  const prescription = await prisma.prescription.findFirst({
    where: { patientIdentifier, status: { in: ['pending', 'verified'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      prescriptionServices: {
        include: {
          service: {
            select: { id: true, name: true, type: true, dosage: true, form: true, genericName: true, testType: true, testCode: true, imageUrl: true, prescriptionRequired: true },
          },
        },
      },
    },
  });

  if (!prescription) {
    throw new Error('Prescription not found or not verified');
  }

  if (prescription.status === 'pending') {
    return {
      services: [],
      prescriptionId: prescription.id,
      orderId: null,
      orderStatus: null,
      prescriptionMetadata: {
        id: prescription.id,
        uploadedAt: prescription.createdAt,
        status: prescription.status,
        fileUrl: prescription.fileUrl,
      },
    };
  }

  let providerIdsWithDistance = [];
  if (hasValidCoordinates) {
    providerIdsWithDistance = await prisma.$queryRaw`
      SELECT 
        id,
        ST_DistanceSphere(
          location,
          ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326)
        ) / 1000 AS distance_km
      FROM "Provider"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${userLng}, ${userLat}), 4326),
        ${radiusKm} * 1000
      )
      AND status = 'verified'
      AND "isActive" = true
    `.then(results =>
      results.map(p => ({
        id: Number(p.id),
        distance_km: parseFloat(p.distance_km.toFixed(2)),
      }))
    );
  }

  const distanceMap = new Map(
    providerIdsWithDistance.map(p => [p.id, p.distance_km])
  );

  const services = await Promise.all(
    prescription.prescriptionServices.map(async prescriptionService => {
      const service = prescriptionService.service;
      const availability = await prisma.providerService.findMany({
        where: {
          serviceId: service.id,
          OR: [
            { stock: { gte: prescriptionService.quantity } }, // For medications
            { available: true }, // For diagnostics
          ],
          provider: {
            status: 'verified',
            isActive: true,
            ...(hasValidCoordinates && {
              id: {
                in: providerIdsWithDistance.length > 0
                  ? providerIdsWithDistance.map(p => p.id)
                  : [-1],
              },
            }),
          },
        },
        include: {
          provider: { select: { id: true, name: true, address: true } },
        },
      });

      return {
        id: service.id,
        displayName: formatServiceDisplayName(service),
        quantity: prescriptionService.quantity,
        type: service.type,
        genericName: service.genericName,
        testType: service.testType,
        testCode: service.testCode,
        imageUrl: service.imageUrl,
        prescriptionRequired: service.prescriptionRequired,
        availability: availability.map(avail => ({
          providerId: avail.provider.id,
          providerName: avail.provider.name,
          address: avail.provider.address,
          price: avail.price,
          distance_km: distanceMap.has(avail.provider.id)
            ? distanceMap.get(avail.provider.id)
            : null,
        })),
      };
    })
  );

  const order = await prisma.order.findFirst({
    where: {
      patientIdentifier,
      prescriptionId: prescription.id,
      status: { in: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'ready_for_pickup', 'sample_collected', 'result_ready', 'completed', 'cancelled'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    services,
    prescriptionId: prescription.id,
    orderId: order?.id,
    orderStatus: order?.status,
    prescriptionMetadata: {
      id: prescription.id,
      uploadedAt: prescription.createdAt,
      status: prescription.status,
      fileUrl: prescription.fileUrl,
    },
  };
}

async function getPrescriptionStatuses({ patientIdentifier, serviceIds }) {
  if (!patientIdentifier) {
    throw new Error('Patient identifier is required');
  }

  try {
    // Validate serviceIds
    const validServiceIds = serviceIds
      .filter(id => id && !isNaN(parseInt(id)))
      .map(id => parseInt(id).toString());
    if (validServiceIds.length === 0) {
      console.warn('No valid service IDs provided:', { patientIdentifier, serviceIds });
      return Object.fromEntries(serviceIds.map(id => [id, 'none']));
    }

    // Fetch the latest prescription for the patient
    const prescription = await prisma.prescription.findFirst({
      where: {
        patientIdentifier,
        status: { in: ['pending', 'verified'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        prescriptionServices: {
          include: {
            service: { select: { id: true } },
          },
        },
      },
    });

    // Initialize statuses as 'none' for all requested serviceIds
    const statuses = Object.fromEntries(
      validServiceIds.map(id => [id, 'none'])
    );

    if (!prescription) {
      console.log('No prescription found for patient:', { patientIdentifier });
      return statuses;
    }

    // Map serviceIds covered by the prescription
    const coveredServiceIds = prescription.prescriptionServices
      .map(ps => ps.serviceId.toString());

    for (const serviceId of validServiceIds) {
      if (coveredServiceIds.includes(serviceId)) {
        statuses[serviceId] = prescription.status; // 'verified' or 'pending'
      }
    }

    console.log('Prescription statuses retrieved:', { patientIdentifier, statuses });
    return statuses;
  } catch (error) {
    console.error('Error fetching prescription statuses:', error);
    throw new Error('Failed to fetch prescription statuses');
  }
}

module.exports = {
  uploadPrescription,
  addServices,
  verifyPrescription,
  getGuestOrder,
  getPrescriptionStatuses,
};