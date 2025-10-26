const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { validateLocation } = require('../utils/location');
const { capitalize, formatPackSizeUnit, formatPerUnitType, formatStrengthUnit } = require('../utils/medicationUtils')
const { ZodError } = require('zod');

async function fetchOrders(pharmacyId, { page = 1, limit = 20, search = '', status = '', date = '', deliveryMethod = '' } = {}) {
  const skip = (page - 1) * limit;

  const baseWhere = {
    OrderItem: { some: { pharmacyId } },
    status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED'] },
  };

  // Add search filter
  if (search) {
    baseWhere.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { trackingCode: { contains: search, mode: 'insensitive' } }, // Added tracking code search
    ];
  }

  // Add status filter
  if (status) {
    baseWhere.status = status;
  }

  // Add date filter
  if (date) {
    const startOfDay = new Date(date + 'T00:00:00.000Z');
    const endOfDay = new Date(date + 'T23:59:59.999Z');
    baseWhere.createdAt = { gte: startOfDay, lte: endOfDay };
  }

  // Add delivery method filter
  if (deliveryMethod) {
    baseWhere.deliveryMethod = deliveryMethod;
  }

  // Total count
  const total = await prisma.order.count({ where: baseWhere });

  // Fetch all order IDs for S/N mapping
  const allPharmacyOrderIds = await prisma.order.findMany({
    where: {
      OrderItem: { some: { pharmacyId } },
      status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const orderPositionMap = new Map(
    allPharmacyOrderIds.map((o, index) => [o.id, index + 1])
  );

  // Fetch paginated orders
  const orders = await prisma.order.findMany({
    where: baseWhere,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      createdAt: true,
      trackingCode: true,
      userIdentifier: true,
      deliveryMethod: true,
      address: true,
      status: true,
      totalPrice: true,
      Prescription: { select: { id: true, fileUrl: true, status: true } },
      OrderItem: {
        select: {
          id: true,
          quantity: true,
          price: true,
          pharmacyId: true,
          medicationId: true,
          MedicationAvailability: {
            select: {
              Medication: {
                select: {
                  brandName: true,
                  form: true,
                  packSizeExpression: true, // Added for better display
                  packSizeUnit: true, // Added for better display
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: { 
                          ActiveSubstance: { select: { name: true } },
                          strengthValue: true, // Added
                          strengthUnit: true, // Added
                        },
                      },
                    },
                  },
                },
              },
              Pharmacy: { select: { name: true, address: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    skip,
    take: limit,
  });

  // Format orders with enhanced medication info
  const formattedOrders = orders.map(order => ({
    id: order.id,
    sn: orderPositionMap.get(order.id),
    name: order.name,
    phone: order.phone,
    email: order.email,
    createdAt: order.createdAt,
    trackingCode: order.trackingCode,
    userIdentifier: order.userIdentifier,
    deliveryMethod: order.deliveryMethod,
    address: order.address,
    status: order.status,
    totalPrice: order.totalPrice,
    prescription: order.Prescription
      ? { id: order.Prescription.id, fileUrl: order.Prescription.fileUrl, status: order.Prescription.status }
      : null,
    items: order.OrderItem
      .filter(item => item.pharmacyId === pharmacyId)
      .map(item => {
        const medication = item.MedicationAvailability.Medication;
        
        // Build active substances with strength
        const activeSubstances = medication.Medication_MedicationIngredient
          .map(mi => {
            const ingredient = mi.MedicationIngredient;
            const substance = ingredient.ActiveSubstance.name;
            const strength = ingredient.strengthValue && ingredient.strengthUnit 
              ? ` ${ingredient.strengthValue}${ingredient.strengthUnit}`
              : '';
            return substance + strength;
          })
          .join(', ');

        return {
          id: item.id,
          medication: {
            brandName: medication.brandName,
            form: medication.form,
            packSize: medication.packSizeExpression && medication.packSizeUnit
              ? `${medication.packSizeExpression} ${medication.packSizeUnit}`
              : '',
            activeSubstances,
            displayName: `${medication.brandName} ${activeSubstances ? `(${activeSubstances})` : ''} ${medication.form ?? ''}`.trim(),
          },
          pharmacy: {
            name: item.MedicationAvailability.Pharmacy.name,
            address: item.MedicationAvailability.Pharmacy.address,
          },
          quantity: item.quantity,
          price: item.price,
        };
      }),
  }));

  return {
    orders: formattedOrders,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}



// function for fetching single order
async function fetchOrderById(pharmacyId, orderId) {
  // Fetch the order
  const order = await prisma.order.findFirst({
    where: { 
      id: orderId,
      OrderItem: { some: { pharmacyId } }, // Ensure pharmacy has items in this order
      status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] } // Only show confirmed orders
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      trackingCode: true,
      userIdentifier: true,
      deliveryMethod: true,
      address: true,
      status: true,
      totalPrice: true,
      paymentReference: true,
      paymentStatus: true,
      paymentMethod: true,
      paymentChannel: true,
      filledAt: true,
      cancelledAt: true,
      cancelReason: true,
      Prescription: { 
        select: { 
          id: true, 
          fileUrl: true, 
          status: true,
          createdAt: true
        } 
      },
      OrderItem: {
        where: { pharmacyId }, // Only get items for this pharmacy
        select: {
          id: true,
          quantity: true,
          price: true,
          pharmacyId: true,
          medicationId: true,
          MedicationAvailability: {
            select: {
              Medication: {
                select: {
                  id: true,
                  brandName: true,
                  form: true,
                  packSizeExpression: true,
                  packSizeUnit: true,
                  Medication_MedicationIngredient: {
                    select: {
                      MedicationIngredient: {
                        select: { 
                          ActiveSubstance: { select: { name: true } },
                          strengthValue: true,
                          strengthUnit: true,
                        },
                      },
                    },
                  },
                },
              },
              Pharmacy: { 
                select: { 
                  id: true,
                  name: true, 
                  address: true,
                  phone: true,
                  lga: true,
                  state: true,
                  ward: true
                } 
              },
            },
          },
        },
      },
    },
  });

  if (!order) {
    const error = new Error('Order not found or you do not have access to this order');
    error.status = 404;
    throw error;
  }

  // Calculate S/N (serial number) for this pharmacy
  const allPharmacyOrderIds = await prisma.order.findMany({
    where: {
      OrderItem: { some: { pharmacyId } },
      status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const orderPositionMap = new Map(
    allPharmacyOrderIds.map((o, index) => [o.id, index + 1])
  );

  // Format the order
  const formattedOrder = {
    id: order.id,
    sn: orderPositionMap.get(order.id),
    name: order.name,
    phone: order.phone,
    email: order.email,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    trackingCode: order.trackingCode,
    userIdentifier: order.userIdentifier,
    deliveryMethod: order.deliveryMethod,
    address: order.address,
    status: order.status,
    totalPrice: order.totalPrice,
    paymentReference: order.paymentReference,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paymentChannel: order.paymentChannel,
    filledAt: order.filledAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    
    prescription: order.Prescription
      ? { 
          id: order.Prescription.id, 
          fileUrl: order.Prescription.fileUrl, 
          status: order.Prescription.status,
          createdAt: order.Prescription.createdAt
        }
      : null,
    
    items: order.OrderItem.map(item => {
      const medication = item.MedicationAvailability.Medication;
      
      // Build active substances with strength
      const activeSubstances = medication.Medication_MedicationIngredient
        .map(mi => {
          const ingredient = mi.MedicationIngredient;
          const substance = ingredient.ActiveSubstance.name;
          const strength = ingredient.strengthValue && ingredient.strengthUnit 
            ? ` ${ingredient.strengthValue}${ingredient.strengthUnit}`
            : '';
          return substance + strength;
        })
        .join(', ');

      return {
        id: item.id,
        orderId: order.id,
        quantity: item.quantity,
        price: item.price,
        medication: {
          id: medication.id,
          brandName: medication.brandName,
          form: medication.form,
          packSize: medication.packSizeExpression && medication.packSizeUnit
            ? `${medication.packSizeExpression} ${medication.packSizeUnit}`
            : '',
          activeSubstances,
          displayName: `${medication.brandName} ${activeSubstances ? `(${activeSubstances})` : ''} ${medication.form ?? ''}`.trim(),
        },
      };
    }),
    
    pharmacy: order.OrderItem[0]?.MedicationAvailability?.Pharmacy || null,
  };

  return formattedOrder;
}


async function updateOrderStatus(orderId, status, pharmacyId) {
  // Import required services
  const refundService = require('./refundService');
  const { sendOrderRejectionNotification } = require('../utils/notifications');
  const { createAuditLog, AUDIT_ACTIONS, ENTITY_TYPES } = require('../utils/audit-logger');
  
  // Find the order that belongs to the given pharmacy
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      OrderItem: {
        some: {
          pharmacyId,
        },
      },
    },
    include: {
      OrderItem: {
        include: {
          MedicationAvailability: {
            include: {
              Medication: {
                select: { brandName: true },
              },
            },
          },
        },
      },
      Pharmacy: {
        select: { name: true }
      }
    }
  });

  if (!order) {
    throw new Error('Order not found for pharmacy');
  }

  // Check if this is a rejection of a paid order
  const isRejection = status === 'CANCELLED';
  const isPaidOrder = order.paymentStatus === 'PAID';
  const needsAutoRefund = isRejection && isPaidOrder;

  if (needsAutoRefund) {
    console.log(`⚠️  Pharmacy ${pharmacyId} rejecting PAID order ${orderId} - initiating auto-refund...`);
    
    // Use transaction to ensure atomicity
    return await prisma.$transaction(async (tx) => {
      // 1. Update order status
      const updateData = { 
        status,
        cancelledAt: new Date(),
        cancelReason: `Pharmacy rejected order`
      };

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: updateData,
        include: {
          OrderItem: {
            where: { pharmacyId },
            include: {
              MedicationAvailability: {
                include: {
                  Medication: {
                    select: { brandName: true },
                  },
                },
              },
            },
          },
        },
      });

      // 2. Restore stock for all order items
      console.log(`📦 Restoring stock for ${order.OrderItem.length} items...`);
      
      for (const item of order.OrderItem) {
        await tx.medicationAvailability.update({
          where: {
            medicationId_pharmacyId: {
              medicationId: item.medicationId,
              pharmacyId: item.pharmacyId
            }
          },
          data: {
            stock: { increment: item.quantity }
          }
        });
        
        console.log(`  ✅ Restored ${item.quantity}x ${item.MedicationAvailability.Medication.brandName}`);
      }

      // 3. Create automatic refund
      console.log('💰 Creating automatic refund...');
      
      const refund = await tx.refund.create({
        data: {
          amount: order.totalPrice,
          reason: `Pharmacy rejected order`,
          refundType: 'AUTOMATIC',
          status: 'PENDING',
          initiatedBy: pharmacyId,
          orderId: orderId
        }
      });

      console.log(`✅ Refund created: ID ${refund.id}, Amount: ${order.totalPrice}`);

      // 4. Create audit log
      await createAuditLog({
        action: 'PHARMACY_ORDER_REJECTED',
        entityType: ENTITY_TYPES.ORDER,
        entityId: orderId,
        userId: null,
        details: {
          pharmacyId,
          pharmacyName: order.Pharmacy?.name,
          refundId: refund.id,
          refundAmount: order.totalPrice.toString(),
          itemsCount: order.OrderItem.length,
          stockRestored: true
        },
        tx
      }).catch(err => console.warn('Failed to create audit log:', err));

      // 5. Send notifications (async, don't block transaction)
      setImmediate(async () => {
        try {
          await sendOrderRejectionNotification(order, refund);
        } catch (error) {
          console.error('Failed to send rejection notification:', error);
        }
      });

      // 6. Auto-process refund (async, don't block transaction)
      setImmediate(async () => {
        try {
          console.log('🤖 Auto-processing refund...');
          await refundService.processRefund(refund.id);
        } catch (error) {
          console.error('Failed to auto-process refund:', error);
        }
      });

      console.log(`✅ Order ${orderId} rejected with auto-refund and stock restoration`);
      
      return updatedOrder;
    });
  }

  // Normal status update (no refund needed)
  const updateData = { status };

  // Set filledAt timestamp for completed statuses
  if (status === 'DELIVERED' || status === 'READY_FOR_PICKUP') {
    updateData.filledAt = new Date();
  }

  // Update order record
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: updateData,
    include: {
      OrderItem: {
        where: { pharmacyId },
        include: {
          MedicationAvailability: {
            include: {
              Medication: {
                select: { brandName: true },
              },
            },
          },
        },
      },
    },
  });

  console.log('Order status updated:', { 
    orderId, 
    status: updatedOrder.status, 
    filledAt: updatedOrder.filledAt,
    pharmacyId 
  });

  return updatedOrder;
}


async function bulkUpdateOrderStatus(orderIds, status, pharmacyId, cancelReason) {
  // Import required services
  const refundService = require('./refundService');
  const { sendOrderRejectionNotification } = require('../utils/notifications');
  const { createAuditLog, AUDIT_ACTIONS, ENTITY_TYPES } = require('../utils/audit-logger');
  
  const results = {
    successful: [],
    failed: []
  };

  // Process each order
  for (const orderId of orderIds) {
    try {
      // Find the order that belongs to the given pharmacy
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          OrderItem: {
            some: { pharmacyId },
          },
        },
        include: {
          OrderItem: {
            include: {
              MedicationAvailability: {
                include: {
                  Medication: {
                    select: { brandName: true },
                  },
                },
              },
            },
          },
          Pharmacy: {
            select: { name: true }
          }
        }
      });

      if (!order) {
        results.failed.push({
          orderId,
          reason: 'Order not found for pharmacy'
        });
        continue;
      }

      // Check if already in this status
      if (order.status === status) {
        results.failed.push({
          orderId,
          reason: `Order already in ${status} status`
        });
        continue;
      }

      // Check if this is a rejection of a paid order
      const isRejection = status === 'CANCELLED';
      const isPaidOrder = order.paymentStatus === 'PAID';
      const needsAutoRefund = isRejection && isPaidOrder;

      if (needsAutoRefund) {
        console.log(`⚠️  Pharmacy ${pharmacyId} rejecting PAID order ${orderId} - initiating auto-refund...`);
        
        // Use transaction to ensure atomicity
        const updatedOrder = await prisma.$transaction(async (tx) => {
          // 1. Update order status
          const updateData = { 
            status,
            cancelledAt: new Date(),
            cancelReason: cancelReason || `Pharmacy rejected order (bulk action)`
          };

          const updated = await tx.order.update({
            where: { id: orderId },
            data: updateData,
            include: {
              OrderItem: {
                where: { pharmacyId },
                include: {
                  MedicationAvailability: {
                    include: {
                      Medication: {
                        select: { brandName: true },
                      },
                    },
                  },
                },
              },
            },
          });

          // 2. Restore stock for all order items
          console.log(`📦 Restoring stock for ${order.OrderItem.length} items (Order ${orderId})...`);
          
          for (const item of order.OrderItem) {
            await tx.medicationAvailability.update({
              where: {
                medicationId_pharmacyId: {
                  medicationId: item.medicationId,
                  pharmacyId: item.pharmacyId
                }
              },
              data: {
                stock: { increment: item.quantity }
              }
            });
            
            console.log(`  ✅ Restored ${item.quantity}x ${item.MedicationAvailability.Medication.brandName}`);
          }

          // 3. Create automatic refund
          console.log(`💰 Creating automatic refund for order ${orderId}...`);
          
          const refund = await tx.refund.create({
            data: {
              amount: order.totalPrice,
              reason: cancelReason || `Pharmacy rejected order (bulk action)`,
              refundType: 'AUTOMATIC',
              status: 'PENDING',
              initiatedBy: pharmacyId,
              orderId: orderId
            }
          });

          console.log(`✅ Refund created: ID ${refund.id}, Amount: ${order.totalPrice}`);

          // 4. Create audit log
          await createAuditLog({
            action: 'PHARMACY_ORDER_REJECTED',
            entityType: ENTITY_TYPES.ORDER,
            entityId: orderId,
            userId: null,
            details: {
              pharmacyId,
              pharmacyName: order.Pharmacy?.name,
              refundId: refund.id,
              refundAmount: order.totalPrice.toString(),
              itemsCount: order.OrderItem.length,
              stockRestored: true,
              bulkAction: true
            },
            tx
          }).catch(err => console.warn('Failed to create audit log:', err));

          // 5. Send notifications (async, don't block transaction)
          setImmediate(async () => {
            try {
              await sendOrderRejectionNotification(order, refund);
            } catch (error) {
              console.error(`Failed to send rejection notification for order ${orderId}:`, error);
            }
          });

          // 6. Auto-process refund (async, don't block transaction)
          setImmediate(async () => {
            try {
              console.log(`🤖 Auto-processing refund for order ${orderId}...`);
              await refundService.processRefund(refund.id);
            } catch (error) {
              console.error(`Failed to auto-process refund for order ${orderId}:`, error);
            }
          });

          console.log(`✅ Order ${orderId} rejected with auto-refund and stock restoration`);
          
          return updated;
        });

        results.successful.push({
          orderId,
          previousStatus: order.status,
          newStatus: status,
          refundInitiated: true,
          stockRestored: true
        });

      } else {
        // Normal status update (no refund needed)
        const updateData = { status };

        // Set filledAt timestamp for completed statuses
        if (status === 'DELIVERED' || status === 'READY_FOR_PICKUP') {
          updateData.filledAt = new Date();
        }

        // If cancelling non-paid order, still restore stock
        if (status === 'CANCELLED') {
          await prisma.$transaction(async (tx) => {
            // Update order
            await tx.order.update({
              where: { id: orderId },
              data: {
                ...updateData,
                cancelledAt: new Date(),
                cancelReason: cancelReason || `Pharmacy cancelled order (bulk action)`
              }
            });

            // Restore stock
            for (const item of order.OrderItem) {
              await tx.medicationAvailability.update({
                where: {
                  medicationId_pharmacyId: {
                    medicationId: item.medicationId,
                    pharmacyId: item.pharmacyId
                  }
                },
                data: {
                  stock: { increment: item.quantity }
                }
              });
            }
          });

          results.successful.push({
            orderId,
            previousStatus: order.status,
            newStatus: status,
            refundInitiated: false,
            stockRestored: true
          });

        } else {
          // Regular status update
          await prisma.order.update({
            where: { id: orderId },
            data: updateData
          });

          results.successful.push({
            orderId,
            previousStatus: order.status,
            newStatus: status,
            refundInitiated: false,
            stockRestored: false
          });
        }

        console.log(`Order ${orderId} status updated:`, { 
          orderId, 
          previousStatus: order.status,
          newStatus: status, 
          filledAt: updateData.filledAt,
          pharmacyId 
        });
      }

    } catch (error) {
      console.error(`❌ Error updating order ${orderId}:`, error);
      results.failed.push({
        orderId,
        reason: error.message || 'Unknown error'
      });
    }
  }

  console.log(`\n📊 Bulk update summary: ${results.successful.length} successful, ${results.failed.length} failed`);
  
  // Log detailed results
  if (results.successful.length > 0) {
    console.log(`✅ Successfully updated orders: ${results.successful.map(r => r.orderId).join(', ')}`);
  }
  if (results.failed.length > 0) {
    console.log(`❌ Failed orders: ${results.failed.map(r => `${r.orderId} (${r.reason})`).join(', ')}`);
  }
  
  return results;
}



async function fetchMedications(pharmacyId, {
  page = 1,
  limit = 10,
  search,
  lowStock,
  outOfStock,
  expiringSoon,
  prescriptionRequired,
} = {}) {
  const skip = (page - 1) * limit;

  // Build where clause for filtering
  const where = { pharmacyId };

  if (search) {
    where.Medication = {
      OR: [
        { brandName: { contains: search, mode: 'insensitive' } },
        {
          Medication_MedicationIngredient: {
            some: {
              MedicationIngredient: {
                ActiveSubstance: { name: { contains: search, mode: 'insensitive' } },
              },
            },
          },
        },
      ],
    };
  }

  if (lowStock) {
    where.stock = { lt: 10, gt: 0 }; // Low stock: 1-9
  } else if (outOfStock) {
    where.stock = { equals: 0 }; // Out of stock: 0
  }

  // NEW: Expiring soon filter
  if (expiringSoon) {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);
    where.expiryDate = {
      gte: today,
      lte: thirtyDaysFromNow
    };
  }

  if (prescriptionRequired !== undefined) {
    const isRequired = prescriptionRequired === 'true';
    where.Medication = {
      ...where.Medication, // Merge with existing Medication conditions
      prescriptionRequired: isRequired,
    };
  }

  // Base where for unfiltered stats
  const allInventoryWhere = { pharmacyId };
  
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  // Parallel queries for paginated inventory, total count, and stats
  const [medications, total, totalItems, lowStockCount, outOfStockCount, expiringSoonCount, allItemsForValue] = await prisma.$transaction([
    // 1. Paginated filtered results
    prisma.medicationAvailability.findMany({
      where,
      include: {
        Medication: {
          include: {
            Manufacturer: { select: { id: true, name: true } },
            Medication_MedicationIngredient: {
              include: {
                MedicationIngredient: {
                  include: { ActiveSubstance: true },
                },
              },
            },
          },
        },
      },
      orderBy: { Medication: { brandName: 'asc' } },
      take: limit,
      skip,
    }),
    
    // 2. Total count for pagination (filtered)
    prisma.medicationAvailability.count({ where }),
    
    // 3. Total items in inventory (unfiltered)
    prisma.medicationAvailability.count({ where: allInventoryWhere }),
    
    // 4. Low stock count (unfiltered)
    prisma.medicationAvailability.count({
      where: { ...allInventoryWhere, stock: { lt: 10, gt: 0 } }
    }),
    
    // 5. Out of stock count (unfiltered)
    prisma.medicationAvailability.count({
      where: { ...allInventoryWhere, stock: { equals: 0 } }
    }),
    
    // 6. Expiring soon count (unfiltered)
    prisma.medicationAvailability.count({
      where: {
        ...allInventoryWhere,
        expiryDate: { gte: today, lte: thirtyDaysFromNow }
      }
    }),
    
    // 7. Get all items for value calculation (unfiltered)
    prisma.medicationAvailability.findMany({
      where: allInventoryWhere,
      select: { stock: true, price: true }
    }),
  ]);

  // Calculate total inventory value
  const totalValue = allItemsForValue.reduce((sum, item) => sum + (item.stock * item.price), 0);

  // Fetch all medications for availableMedications (unpaginated, unfiltered)
  const allMedications = await prisma.medication.findMany({
    include: {
      Medication_MedicationIngredient: {
        include: {
          MedicationIngredient: {
            include: { ActiveSubstance: true },
          },
        },
      },
    },
  });

  // Helper to format ingredients
  const formatIngredients = (medicationIngredients) => {
    return medicationIngredients.map(mmi => ({
      id: mmi.MedicationIngredient.id,
      activeSubstanceId: mmi.MedicationIngredient.ActiveSubstance?.id || null,
      activeSubstanceName: mmi.MedicationIngredient.ActiveSubstance?.name || null,
      strengthValue: mmi.MedicationIngredient.strengthValue,
      strengthUnit: formatStrengthUnit(mmi.MedicationIngredient.strengthUnit),
      perUnitValue: mmi.MedicationIngredient.perUnitValue,
      perUnitType: formatPerUnitType(mmi.MedicationIngredient.perUnitType),
    }));
  };

  // Format medications (inventory items)
  const formattedMedications = medications.map(m => {
    const ingredients = formatIngredients(m.Medication.Medication_MedicationIngredient);
    const activeSubstancesDisplay = ingredients
      .map(ing => {
        const substance = ing.activeSubstanceName;
        let strengthPart = '';
        if (ing.strengthValue) {
          strengthPart += `${ing.strengthValue}`;
          if (ing.strengthUnit) strengthPart += ` ${ing.strengthUnit}`;
        }
        return strengthPart ? `${substance} ${strengthPart}` : substance;
      })
      .join(', ');

    return {
      pharmacyId: m.pharmacyId,
      medicationId: m.medicationId,
      brandName: m.Medication.brandName,
      form: m.Medication.form,
      packSizeExpression: m.Medication.packSizeExpression,
      packSizeUnit: formatPackSizeUnit(m.Medication.packSizeUnit),
      ingredients: ingredients,
      activeSubstances: activeSubstancesDisplay,
      displayName: `${m.Medication.brandName} (${activeSubstancesDisplay})`,
      manufacturer: m.Medication.Manufacturer ? {
        id: m.Medication.Manufacturer.id,
        name: m.Medication.Manufacturer.name
      } : null,
      manufacturerName: m.Medication.Manufacturer?.name || null,
      stock: m.stock,
      price: m.price,
      expiryDate: m.expiryDate,
      receivedDate: m.receivedDate,
      batchNumber: m.batchNumber,
    };
  });

  // Format availableMedications
  const formattedAvailable = allMedications.map(m => {
    const ingredients = formatIngredients(m.Medication_MedicationIngredient);
    const activeSubstancesDisplay = ingredients
      .map(ing => {
        const substance = ing.activeSubstanceName;
        let strengthPart = '';
        if (ing.strengthValue) {
          strengthPart += `${ing.strengthValue}`;
          if (ing.strengthUnit) strengthPart += ` ${ing.strengthUnit}`;
        }
        return strengthPart ? `${substance} ${strengthPart}` : substance;
      })
      .join(', ');

    return {
      id: m.id,
      brandName: m.brandName,
      ingredients: ingredients,
      activeSubstances: activeSubstancesDisplay,
      displayName: `${m.brandName} (${activeSubstancesDisplay})${m.form ? ' ' + m.form : ''}`,
    };
  });

  console.log('Medications fetched:', { 
    count: formattedMedications.length, 
    total, 
    totalItems,
    stats: { 
      lowStock: lowStockCount, 
      outOfStock: outOfStockCount, 
      expiringSoon: expiringSoonCount,
      totalValue 
    }
  });

  return {
    medications: formattedMedications,
    availableMedications: formattedAvailable,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    summary: {
      totalItems,
      lowStockCount,
      outOfStockCount,
      expiringSoonCount,
      totalValue: Math.round(totalValue),
    }
  };
}


/**
 * Add medication to pharmacy inventory
 */
async function addMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate, batchNumber }) {
  const existing = await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });
  if (existing) throw new Error('Medication already exists in pharmacy inventory');

  const medication = await prisma.medicationAvailability.create({
    data: {
      pharmacyId,
      medicationId,
      stock,
      price: parseFloat(price.toFixed(2)),
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      batchNumber,
    },
    include: {
      Medication: { include: { Medication_MedicationIngredient: { include: { MedicationIngredient: { include: { ActiveSubstance: true } } } } } },
    },
  });

  const activeSubstances = medication.Medication.Medication_MedicationIngredient
    .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
    .join(', ');

  return {
    pharmacyId: medication.pharmacyId,
    medicationId: medication.medicationId,
    brandName: medication.Medication.brandName,
    activeSubstances,
    stock: medication.stock,
    price: medication.price,
    receivedDate: medication.receivedDate,
    expiryDate: medication.expiryDate,
    batchNumber,
  };
}

/**
 * Update medication in pharmacy inventory
 */
async function updateMedication({ pharmacyId, medicationId, stock, price, receivedDate, expiryDate, batchNumber }) {
  const medication = await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    include: {
      Medication: { include: { Medication_MedicationIngredient: { include: { MedicationIngredient: { include: { ActiveSubstance: true } } } } } },
    },
  });
  if (!medication) throw new Error('Medication not found');

  const updatedMedication = await prisma.medicationAvailability.update({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    data: {
      stock,
      price: parseFloat(price.toFixed(2)),
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      batchNumber,
    },
    include: {
      Medication: { include: { Medication_MedicationIngredient: { include: { MedicationIngredient: { include: { ActiveSubstance: true } } } } } },
    },
  });

  const activeSubstances = updatedMedication.Medication.Medication_MedicationIngredient
    .map(mi => mi.MedicationIngredient.ActiveSubstance.name)
    .join(', ');

  return {
    pharmacyId: updatedMedication.pharmacyId,
    medicationId: updatedMedication.medicationId,
    brandName: updatedMedication.Medication.brandName,
    activeSubstances,
    stock: updatedMedication.stock,
    price: updatedMedication.price,
    receivedDate: updatedMedication.receivedDate,
    expiryDate: updatedMedication.expiryDate,
    batchNumber: updatedMedication.batchNumber,
  };
}

async function deleteMedication(pharmacyId, medicationId) {
  const medication = await prisma.medicationAvailability.findUnique({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });
  if (!medication) {
    throw new Error('Medication not found');
  }

  await prisma.medicationAvailability.delete({
    where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
  });

  console.log('Medication deleted:', { pharmacyId, medicationId });
}

async function fetchUsers(pharmacyId) {
  const users = await prisma.pharmacyUser.findMany({
    where: { pharmacyId },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log('Users fetched:', { pharmacyId, userCount: users.length });
  return users;
}

async function registerDevice(pharmacyId, deviceToken) {
  await prisma.pharmacy.update({
    where: { id: pharmacyId },
    data: { devicetoken: deviceToken },
  });
  console.log('Device registered:', { pharmacyId });
}

async function getProfile(userId, pharmacyId) {
  const user = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
    select: { 
      id: true, 
      name: true, 
      email: true, 
      role: true,
      lastLogin: true 
    },
  });
  
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { 
      id: true, 
      name: true, 
      address: true, 
      lga: true, 
      state: true, 
      ward: true, 
      phone: true, 
      licenseNumber: true, 
      status: true, 
      logoUrl: true,
      latitude: true,
      longitude: true,
      deliveryAvailability: true,
      pharmacyType: true,
      isActive: true,
      createdAt: true,
      verifiedAt: true,
      // Include operating hours
      OperatingHour: {
        select: {
          id: true,
          dayOfWeek: true,
          openTime: true,
          closeTime: true,
        }
      }
    },
  });
  
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }

  console.log('Profile fetched:', { userId, pharmacyId });

  return { user, pharmacy };
}



async function editProfile({ user, pharmacy }, userId, pharmacyId) {
  // Validate location if coordinates provided
  if (pharmacy.latitude && pharmacy.longitude) {
    validateLocation(
      pharmacy.state, 
      pharmacy.lga, 
      pharmacy.ward, 
      pharmacy.latitude, 
      pharmacy.longitude
    );
  }

  // Check email uniqueness
  const existingUser = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
  });
  
  if (user.email !== existingUser.email) {
    const emailConflict = await prisma.pharmacyUser.findUnique({
      where: { email: user.email },
    });
    if (emailConflict) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
    }
  }

  const result = await prisma.$transaction(async (prisma) => {
    // Update user
    const updatedUser = await prisma.pharmacyUser.update({
      where: { id: userId },
      data: { 
        name: user.name, 
        email: user.email 
      },
    });

    // Prepare pharmacy update data
    const pharmacyUpdateData = {
      name: pharmacy.name,
      address: pharmacy.address,
      lga: pharmacy.lga,
      state: pharmacy.state,
      ward: pharmacy.ward || null,
      phone: pharmacy.phone,
      logoUrl: pharmacy.logoUrl || null,
      latitude: pharmacy.latitude ? parseFloat(pharmacy.latitude) : null,
      longitude: pharmacy.longitude ? parseFloat(pharmacy.longitude) : null,
      deliveryAvailability: pharmacy.deliveryAvailability || false,
    };

    // Update pharmacy
    const updatedPharmacy = await prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: pharmacyUpdateData,
    });

    // Update PostGIS location if coordinates provided
    if (pharmacy.latitude && pharmacy.longitude) {
      await prisma.$queryRaw`
        UPDATE "Pharmacy"
        SET location = ST_SetSRID(ST_MakePoint(${parseFloat(pharmacy.longitude)}, ${parseFloat(pharmacy.latitude)}), 4326),
            "locationCapturedAt" = NOW()
        WHERE id = ${pharmacyId}
      `;
    }

    return { user: updatedUser, pharmacy: updatedPharmacy };
  });

  console.log('Profile updated:', { userId, pharmacyId });

  return { updatedUser: result.user, updatedPharmacy: result.pharmacy };
}



async function getDashboardData(pharmacyId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Yesterday range
  const startOfYesterday = new Date(startOfDay);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const endOfYesterday = new Date(endOfDay);
  endOfYesterday.setDate(endOfYesterday.getDate() - 1);

  // Parallel queries
  const [
    ordersToday,
    ordersYesterday,
    pendingOrders,
    processingOrders,
    readyOrders,
    inventoryAlerts,
    expiringMeds,
    revenueTodayResult,
    revenueYesterdayResult,
    posSalesToday,
    posSalesYesterday,
    posRevenueTodayResult,
    posRevenueYesterdayResult,
    topSellingMeds,
    recentOrders,
    recentSales,
    lowStockMeds,
  ] = await Promise.all([
    // Orders today
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
    // Orders yesterday
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
        createdAt: { gte: startOfYesterday, lte: endOfYesterday },
      },
    }),
    // Pending
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: 'CONFIRMED',
      },
    }),
    // Processing
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: 'PROCESSING',
      },
    }),
    // Ready for pickup
    prisma.order.count({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: 'READY_FOR_PICKUP',
      },
    }),
    // Inventory alerts
    prisma.medicationAvailability.count({
      where: { pharmacyId, stock: { lt: 10 } },
    }),
    // Expiring meds
    prisma.medicationAvailability.count({
      where: {
        pharmacyId,
        expiryDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    // Revenue today
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED'] },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
    // Revenue yesterday
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED'] },
        createdAt: { gte: startOfYesterday, lte: endOfYesterday },
      },
    }),
    // PoS sales today
    prisma.sale.count({
      where: { pharmacyId, createdAt: { gte: startOfDay, lte: endOfDay } },
    }),
    // PoS sales yesterday
    prisma.sale.count({
      where: { pharmacyId, createdAt: { gte: startOfYesterday, lte: endOfYesterday } },
    }),
    // PoS revenue today
    prisma.sale.aggregate({
      _sum: { total: true },
      where: { pharmacyId, createdAt: { gte: startOfDay, lte: endOfDay } },
    }),
    // PoS revenue yesterday
    prisma.sale.aggregate({
      _sum: { total: true },
      where: { pharmacyId, createdAt: { gte: startOfYesterday, lte: endOfYesterday } },
    }),
    // Top selling meds
    prisma.$queryRaw`
      SELECT 
        m."brandName",
        COUNT(oi.id) as order_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue
      FROM "OrderItem" oi
      INNER JOIN "MedicationAvailability" ma ON oi."medicationId" = ma."medicationId" AND oi."pharmacyId" = ma."pharmacyId"
      INNER JOIN "Medication" m ON ma."medicationId" = m.id
      INNER JOIN "Order" o ON oi."orderId" = o.id
      WHERE oi."pharmacyId" = ${pharmacyId}
        AND o."createdAt" >= NOW() - INTERVAL '7 days'
        AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED')
      GROUP BY m.id, m."brandName"
      ORDER BY total_quantity DESC
      LIMIT 5
    `,
    // Recent orders
    prisma.order.findMany({
      where: {
        OrderItem: { some: { pharmacyId } },
        status: { notIn: ['CART', 'PENDING', 'PENDING_PRESCRIPTION'] },
      },
      select: {
        id: true,
        status: true,
        totalPrice: true,
        createdAt: true,
        name: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    // Recent sales
    prisma.sale.findMany({
      where: { pharmacyId },
      select: {
        id: true,
        total: true,
        paymentMethod: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    // Low stock
    prisma.medicationAvailability.findMany({
      where: { pharmacyId, stock: { lt: 10, gt: 0 } },
      include: {
        Medication: { select: { brandName: true, form: true } },
      },
      orderBy: { stock: 'asc' },
      take: 5,
    }),
  ]);

  // --- Calculations ---
  const revenueToday = revenueTodayResult._sum.totalPrice || 0;
  const revenueYesterday = revenueYesterdayResult._sum.totalPrice || 0;
  const posRevenueToday = posRevenueTodayResult._sum.total || 0;
  const posRevenueYesterday = posRevenueYesterdayResult._sum.total || 0;

  const calculateTrend = (today, yesterday) => {
    if (yesterday === 0) return today > 0 ? 100 : 0;
    return Math.round(((today - yesterday) / yesterday) * 100);
  };

  // --- Merge Orders + Sales ---
  const normalizedOrders = recentOrders.map(o => ({
    id: o.id,
    type: 'ORDER',
    name: o.name,
    status: o.status,
    amount: o.totalPrice,
    time: o.createdAt,
  }));

  const normalizedSales = recentSales.map(s => ({
    id: s.id,
    type: 'SALE',
    name: 'POS Sale',
    status: s.paymentMethod?.toUpperCase() || 'PAID',
    amount: s.total,
    time: s.createdAt,
  }));

  const recentActivity = [...normalizedOrders, ...normalizedSales]
    .sort((a, b) => b.time - a.time)
    .slice(0, 10);

  // --- Final Return ---
  return {
    ordersToday,
    ordersTrend: calculateTrend(ordersToday, ordersYesterday),
    posSalesToday,
    posSalesTrend: calculateTrend(posSalesToday, posSalesYesterday),
    revenueToday,
    revenueTrend: calculateTrend(revenueToday, revenueYesterday),
    posRevenueToday,
    posRevenueTrend: calculateTrend(posRevenueToday, posRevenueYesterday),
    pendingOrders,
    processingOrders,
    readyOrders,
    inventoryAlerts,
    expiringMeds,
    topSellingMeds: topSellingMeds.map(med => ({
      name: med.brandName,
      quantity: Number(med.total_quantity),
      revenue: Number(med.total_revenue),
      orders: Number(med.order_count),
    })),
    recentActivity,
    lowStockMeds: lowStockMeds.map(med => ({
      name: med.Medication.brandName,
      form: med.Medication.form,
      stock: med.stock,
      price: med.price,
    })),
  };
}


async function getWeeklyAnalytics(pharmacyId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const dailyStats = await prisma.$queryRaw`
    SELECT 
      DATE(o."createdAt") as date,
      COUNT(DISTINCT o.id) as orders,
      SUM(o."totalPrice") as revenue
    FROM "Order" o
    INNER JOIN "OrderItem" oi ON o.id = oi."orderId"
    WHERE oi."pharmacyId" = ${pharmacyId}
      AND o."createdAt" >= ${weekAgo}
      AND o.status NOT IN ('CART', 'PENDING', 'PENDING_PRESCRIPTION', 'CANCELLED')
    GROUP BY DATE(o."createdAt")
    ORDER BY date DESC
  `;

  const posDailyStats = await prisma.$queryRaw`
    SELECT 
      DATE("createdAt") as date,
      COUNT(id) as sales,
      SUM(total) as revenue
    FROM "Sale"
    WHERE "pharmacyId" = ${pharmacyId}
      AND "createdAt" >= ${weekAgo}
    GROUP BY DATE("createdAt")
    ORDER BY date DESC
  `;

  return {
    onlineOrders: dailyStats.map(stat => ({
      date: stat.date,
      orders: Number(stat.orders),
      revenue: Number(stat.revenue),
    })),
    posSales: posDailyStats.map(stat => ({
      date: stat.date,
      sales: Number(stat.sales),
      revenue: Number(stat.revenue),
    })),
  };
}

async function recordSale({ pharmacyId, items, total, paymentMethod }) {
  // Decrement stock for each item
  await Promise.all(items.map(async (item) => {
    const { medicationId, quantity } = item;
    const medAvail = await prisma.medicationAvailability.findUnique({
      where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
    });
    if (!medAvail) throw new Error(`Medication ${medicationId} not found in pharmacy inventory`);
    if (medAvail.stock < quantity) throw new Error(`Insufficient stock for medication ${medicationId}`);
    await prisma.medicationAvailability.update({
      where: { medicationId_pharmacyId: { medicationId, pharmacyId } },
      data: { stock: { decrement: quantity } },
    });
  }));
  // Create the sale
  const sale = await prisma.sale.create({
    data: {
      pharmacyId,
      items,
      total,
      paymentMethod,
    },
  });
  return sale;
}

async function fetchSales(pharmacyId, filters) {
  const { date, startDate, endDate, paymentMethod, minAmount, maxAmount } = filters;
  
  let where = { pharmacyId };
  
  // Date filtering
  if (date) {
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');
    where.createdAt = { gte: start, lte: end };
  } else if (startDate && endDate) {
    where.createdAt = {
      gte: new Date(startDate + 'T00:00:00.000Z'),
      lte: new Date(endDate + 'T23:59:59.999Z')
    };
  }
  
  // Payment method
  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }
  
  // Amount range
  if (minAmount || maxAmount) {
    where.total = {};
    if (minAmount) where.total.gte = parseFloat(minAmount);
    if (maxAmount) where.total.lte = parseFloat(maxAmount);
  }
  
  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  
  return sales;
}

/**
 * Reject order and trigger automatic refund
 */
async function rejectOrder(orderId, pharmacyId, reason) {
  try {
    console.log(`🚫 Pharmacy ${pharmacyId} rejecting order ${orderId}...`);

    // Verify order belongs to pharmacy
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        OrderItem: {
          where: { pharmacyId: pharmacyId }
        }
      }
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.OrderItem.length === 0) {
      throw new Error(`Order ${orderId} does not belong to pharmacy ${pharmacyId}`);
    }

    if (order.status === 'CANCELLED') {
      throw new Error(`Order ${orderId} is already cancelled`);
    }

    if (order.status === 'DELIVERED') {
      throw new Error(`Cannot reject delivered order ${orderId}`);
    }

    // Update order status
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: `Rejected by pharmacy: ${reason}`
      }
    });

    console.log(`✅ Order ${orderId} cancelled`);

    // Trigger automatic refund if order was paid
    if (order.paymentStatus === 'PAID') {
      console.log(`💰 Triggering automatic refund for order ${orderId}...`);
      
      const refundService = require('./refundService');
      
      await refundService.createRefund({
        orderId: orderId,
        amount: order.totalPrice,
        reason: `Order rejected by pharmacy: ${reason}`,
        refundType: 'AUTOMATIC',
        initiatedBy: pharmacyId
      });

      console.log(`✅ Automatic refund triggered for order ${orderId}`);
    } else {
      console.log(`⚠️  Order ${orderId} was not paid, no refund needed`);
    }

    return order;

  } catch (error) {
    console.error('❌ Error rejecting order:', error);
    throw error;
  }
}

module.exports = {
  fetchOrders,
  fetchOrderById,
  updateOrderStatus,
  bulkUpdateOrderStatus,
  fetchMedications,
  addMedication,
  updateMedication,
  deleteMedication,
  fetchUsers,
  registerDevice,
  getProfile,
  editProfile,
  getDashboardData,
  getWeeklyAnalytics,
  recordSale,
  fetchSales,
  rejectOrder,
};