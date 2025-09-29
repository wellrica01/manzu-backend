const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { isValidOrderReference } = require('../utils/validation');
const { generateTrackingCode } = require('../utils/tracking');
const prisma = new PrismaClient();

async function confirmOrder({ reference, session, userId }) {
  try {
    console.log('confirmOrder called with:', { reference, session, userId });

    let transactionRef = null;

    // Validate reference if provided
    if (reference) {
      if (!isValidOrderReference(reference)) {
        throw new Error('Invalid payment reference format');
      }

      transactionRef = await prisma.transactionReference.findFirst({
        where: { transactionReference: reference },
      }) || await prisma.transactionReference.findFirst({
        where: { orderReferences: { has: reference } },
      });

      if (!transactionRef) throw new Error('Transaction reference not found');
    }

    // Fetch orders
    let orders = [];
    const orderWhere = transactionRef
      ? { userIdentifier: userId, paymentReference: { in: transactionRef.orderReferences } }
      : { userIdentifier: userId, checkoutSessionId: session, status: { in: ['PENDING', 'CONFIRMED'] } };

    orders = await prisma.order.findMany({
      where: orderWhere,
      include: {
        OrderItem: {
          include: {
            MedicationAvailability: {
              include: {
                Medication: {
                  include: {
                    Medication_MedicationIngredient: {
                      select: {
                        MedicationIngredient: {
                          select: {
                            strengthValue: true,
                            strengthUnit: true,
                            ActiveSubstance: { select: { name: true } }
                          }
                        }
                      }
                    }
                  }
                },
                Pharmacy: { include: { OperatingHour: true } },
              }
            }
          }
        },
        Prescription: { include: { PrescriptionMedication: true } },
        Pharmacy: { include: { OperatingHour: true } },
      }
    });

    if (orders.length === 0) throw new Error('Orders not found');

    // Generate or reuse tracking code
    const existingTrackingCode = orders.find(o => o.trackingCode)?.trackingCode;
    const trackingCode = existingTrackingCode || generateTrackingCode(session, orders[0]?.id);
    let status = 'COMPLETED';

    // Verify Paystack transaction if reference exists
    if (transactionRef) {
      try {
        const paystackResponse = await axios.get(
          `https://api.paystack.co/transaction/verify/${transactionRef.transactionReference}`,
          { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
        );

        if (!paystackResponse.data.status || paystackResponse.data.data.status !== 'success') {
          await prisma.$transaction(async tx => {
            for (const order of orders) {
              if (transactionRef.orderReferences.includes(order.paymentReference)) {
                await tx.order.update({
                  where: { id: order.id },
                  data: { paymentStatus: 'failed', updatedAt: new Date() },
                });
              }
            }
          });
          throw new Error('Payment verification failed');
        }
      } catch (error) {
        console.error('Paystack verification error:', error.response?.data || error.message);
        throw new Error('Payment verification failed');
      }
    }

    // Check verified prescriptions
    const verifiedPrescription = await prisma.prescription.findFirst({
      where: { userIdentifier: userId, status: 'VERIFIED' },
      include: { PrescriptionMedication: true },
      orderBy: [{ createdAt: 'desc' }],
    });

    // Update orders in a transaction
    const updatedOrders = await prisma.$transaction(async tx => {
      const updated = [];
      for (const order of orders) {
        let newStatus = order.status;
        let newPaymentStatus = order.paymentStatus;
        let newPrescriptionId = order.prescriptionId;

        const requiresPrescription = order.OrderItem.some(
          item => item.MedicationAvailability.Medication.prescriptionRequired
        );

        if (requiresPrescription && verifiedPrescription) {
          const orderMedicationIds = order.OrderItem
            .filter(item => item.MedicationAvailability.Medication.prescriptionRequired)
            .map(item => item.MedicationAvailability.medicationId);
          const prescriptionMedicationIds = verifiedPrescription.PrescriptionMedication.map(pm => pm.medicationId);
          const isPrescriptionValid = orderMedicationIds.every(id => prescriptionMedicationIds.includes(id));

          if (isPrescriptionValid && (transactionRef?.orderReferences.includes(order.paymentReference) || !transactionRef)) {
            newStatus = 'CONFIRMED';
            newPaymentStatus = 'PAID';
            newPrescriptionId = verifiedPrescription.id;
          } else if (order.status === 'PENDING_PRESCRIPTION') {
            status = 'PENDING_PRESCRIPTION';
          }
        } else if (!requiresPrescription && (transactionRef?.orderReferences.includes(order.paymentReference) || !transactionRef)) {
          newStatus = 'CONFIRMED';
          newPaymentStatus = 'PAID';
        } else if (order.status === 'PENDING_PRESCRIPTION') {
          status = 'PENDING_PRESCRIPTION';
        }

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: newPaymentStatus, status: newStatus, trackingCode, prescriptionId: newPrescriptionId, updatedAt: new Date() },
          include: {
            OrderItem: {
              include: {
                MedicationAvailability: {
                  include: {
                    Medication: {
                      include: {
                        Medication_MedicationIngredient: {
                          select: {
                            MedicationIngredient: {
                              select: {
                                strengthValue: true,
                                strengthUnit: true,
                                ActiveSubstance: { select: { name: true } }
                              }
                            }
                          }
                        }
                      }
                    },
                    Pharmacy: { include: { OperatingHour: true } },
                  }
                }
              }
            },
            Prescription: true,
            Pharmacy: { include: { OperatingHour: true } },
          }
        });

        updated.push(updatedOrder);
      }
      return updated;
    });

    // Format response grouped by pharmacy
    const ordersByPharmacy = updatedOrders
      .filter(o => o.status === 'CONFIRMED' && o.paymentStatus === 'PAID')
      .reduce((acc, order) => {
        const pharmacyId = order.pharmacyId;
        if (!acc[pharmacyId]) {
          acc[pharmacyId] = {
            pharmacy: {
              id: pharmacyId,
              name: order.Pharmacy?.name || 'Unknown',
              address: order.Pharmacy?.address || '',
              logoUrl: order.Pharmacy?.logoUrl || '',
              phone: order.Pharmacy?.phone || '',
              operatingHours: Array.isArray(order.Pharmacy?.OperatingHour)
                ? order.Pharmacy.OperatingHour.map(h => ({
                    dayOfWeek: h.dayOfWeek,
                    openTime: h.openTime,
                    closeTime: h.closeTime,
                  }))
                : [],
              ward: order.Pharmacy?.ward || '',
              lga: order.Pharmacy?.lga || '',
              state: order.Pharmacy?.state || '',
            },
            orders: [],
            subtotal: 0,
          };
        }

        acc[pharmacyId].orders.push({
          id: order.id,
          name: order.name,
          totalPrice: order.totalPrice,
          status: order.status,
          deliveryMethod: order.deliveryMethod,
          address: order.address,
          paymentReference: order.paymentReference,
          prescription: order.Prescription
            ? {
                id: order.Prescription.id,
                status: order.Prescription.status,
                fileUrl: order.Prescription.fileUrl,
              }
            : null,
          items: order.OrderItem.map(item => {
            const ingredients = item.MedicationAvailability.Medication.Medication_MedicationIngredient.map(
              mmi => ({
                activeSubstance: mmi.MedicationIngredient.ActiveSubstance?.name || null,
                strengthValue: mmi.MedicationIngredient.strengthValue || null,
                strengthUnit: mmi.MedicationIngredient.strengthUnit || null,
              })
            );

            return {
              id: item.id,
              medication: {
                brandName: item.MedicationAvailability.Medication.brandName,
                fullName: item.MedicationAvailability.Medication.fullName,
                prescriptionRequired: item.MedicationAvailability.Medication.prescriptionRequired,
                ingredients, // <-- all ingredients included
              },
              quantity: item.quantity,
              price: item.price,
            };
          }),
        });

        acc[pharmacyId].subtotal += order.totalPrice;
        return acc;
      }, {});

    return {
      message: status === 'COMPLETED' ? 'Payment verified' : 'Orders retrieved, some awaiting verification',
      status,
      checkoutSessionId: session,
      trackingCode,
      pharmacies: Object.values(ordersByPharmacy),
    };

  } catch (error) {
    console.error('Error in confirmOrder:', error);
    throw error;
  }
}

module.exports = { confirmOrder };
