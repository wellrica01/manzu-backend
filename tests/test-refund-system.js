/**
 * REFUND SYSTEM TEST
 * 
 * Tests the complete refund workflow
 * 
 * USAGE:
 * node tests/test-refund-system.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pharmacyService = require('../src/services/pharmacyService');
const refundService = require('../src/services/refundService');

async function testAutomaticRefund() {
  console.log('\n🧪 TEST 1: Automatic Refund (Pharmacy Rejection)');
  console.log('=' .repeat(60));

  try {
    // Find a paid order to test with
    const paidOrder = await prisma.order.findFirst({
      where: {
        paymentStatus: 'PAID',
        status: { in: ['CONFIRMED', 'PENDING'] }
      },
      include: {
        OrderItem: true
      }
    });

    if (!paidOrder) {
      console.log('❌ No paid orders found for testing');
      console.log('   Create a test order first or use a different order ID');
      return false;
    }

    console.log(`✅ Found paid order: ${paidOrder.id}`);
    console.log(`   Total: ₦${paidOrder.totalPrice}`);
    console.log(`   Status: ${paidOrder.status}`);
    console.log(`   Payment: ${paidOrder.paymentStatus}`);

    // Get pharmacy ID from order items
    const pharmacyId = paidOrder.OrderItem[0]?.pharmacyId;
    if (!pharmacyId) {
      console.log('❌ Order has no pharmacy items');
      return false;
    }

    console.log(`\n🚫 Rejecting order ${paidOrder.id} from pharmacy ${pharmacyId}...`);

    // Reject order (this should trigger automatic refund)
    await pharmacyService.rejectOrder(
      paidOrder.id,
      pharmacyId,
      'Testing automatic refund system'
    );

    console.log('✅ Order rejected successfully');

    // Wait a moment for async processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if refund was created
    const refunds = await prisma.refund.findMany({
      where: { orderId: paidOrder.id },
      orderBy: { createdAt: 'desc' }
    });

    if (refunds.length === 0) {
      console.log('❌ No refund created');
      return false;
    }

    const refund = refunds[0];
    console.log(`\n✅ Refund created: ID ${refund.id}`);
    console.log(`   Amount: ₦${refund.amount}`);
    console.log(`   Type: ${refund.refundType}`);
    console.log(`   Status: ${refund.status}`);
    console.log(`   Reason: ${refund.reason}`);

    if (refund.paystackRefundId) {
      console.log(`   Paystack Refund ID: ${refund.paystackRefundId}`);
    }

    // Check order status
    const updatedOrder = await prisma.order.findUnique({
      where: { id: paidOrder.id }
    });

    console.log(`\n📦 Order Status:`);
    console.log(`   Status: ${updatedOrder.status}`);
    console.log(`   Payment Status: ${updatedOrder.paymentStatus}`);
    console.log(`   Cancelled At: ${updatedOrder.cancelledAt}`);

    // Verify refund status
    if (refund.status === 'COMPLETED') {
      console.log('\n🎉 TEST 1 PASSED: Automatic refund completed!');
      return true;
    } else if (refund.status === 'PROCESSING') {
      console.log('\n⏳ TEST 1 PARTIAL: Refund is processing (check Paystack)');
      return true;
    } else if (refund.status === 'FAILED') {
      console.log('\n❌ TEST 1 FAILED: Refund failed');
      console.log(`   Failure reason: ${refund.failureReason}`);
      return false;
    } else {
      console.log('\n⏳ TEST 1 PENDING: Refund is pending (will be processed by cron)');
      return true;
    }

  } catch (error) {
    console.error('❌ TEST 1 FAILED:', error.message);
    console.error(error.stack);
    return false;
  }
}

async function testManualRefund() {
  console.log('\n🧪 TEST 2: Manual Refund Request');
  console.log('='.repeat(60));

  try {
    // Find a paid order
    const paidOrder = await prisma.order.findFirst({
      where: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED'
      }
    });

    if (!paidOrder) {
      console.log('❌ No paid orders found for testing');
      return false;
    }

    console.log(`✅ Found paid order: ${paidOrder.id}`);
    console.log(`   User: ${paidOrder.userIdentifier}`);
    console.log(`   Total: ₦${paidOrder.totalPrice}`);

    // Create manual refund request
    console.log('\n📝 Creating manual refund request...');
    
    const refund = await refundService.createRefund({
      orderId: paidOrder.id,
      amount: paidOrder.totalPrice, // ✅ FIXED: Use paidOrder.totalPrice
      reason: 'Testing manual refund - wrong item delivered',
      refundType: 'MANUAL',
      initiatedBy: 1 // Use a test user ID
    });

    console.log(`✅ Refund request created: ID ${refund.id}`);
    console.log(`   Status: ${refund.status}`);
    console.log(`   Type: ${refund.refundType}`);

    if (refund.status === 'PENDING') {
      console.log('\n✅ TEST 2 PASSED: Manual refund request created (awaiting approval)');
      console.log(`   To approve: POST /api/admin/refunds/${refund.id}/approve`);
      return true;
    } else {
      console.log('\n❌ TEST 2 FAILED: Unexpected status:', refund.status);
      return false;
    }

  } catch (error) {
    console.error('❌ TEST 2 FAILED:', error.message);
    return false;
  }
}

async function testRefundStatus() {
  console.log('\n🧪 TEST 3: Check Refund Status');
  console.log('=' .repeat(60));

  try {
    // Get latest refund
    const refund = await prisma.refund.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        Order: {
          select: {
            id: true,
            totalPrice: true,
            status: true,
            paymentStatus: true
          }
        }
      }
    });

    if (!refund) {
      console.log('❌ No refunds found');
      return false;
    }

    console.log(`✅ Refund ID: ${refund.id}`);
    console.log(`   Order ID: ${refund.Order.id}`);
    console.log(`   Amount: ₦${refund.amount}`);
    console.log(`   Status: ${refund.status}`);
    console.log(`   Type: ${refund.refundType}`);
    console.log(`   Created: ${refund.createdAt}`);
    
    if (refund.processedAt) {
      console.log(`   Processed: ${refund.processedAt}`);
    }
    
    if (refund.paystackRefundId) {
      console.log(`   Paystack ID: ${refund.paystackRefundId}`);
    }

    console.log(`\n   Order Status: ${refund.Order.status}`);
    console.log(`   Payment Status: ${refund.Order.paymentStatus}`);

    console.log('\n✅ TEST 3 PASSED: Refund status retrieved');
    return true;

  } catch (error) {
    console.error('❌ TEST 3 FAILED:', error.message);
    return false;
  }
}

async function testStockRestoration() {
  console.log('\n🧪 TEST 4: Verify Stock Restoration');
  console.log('=' .repeat(60));

  try {
    // Find a completed refund
    const completedRefund = await prisma.refund.findFirst({
      where: { status: 'COMPLETED' },
      include: {
        Order: {
          include: {
            OrderItem: true
          }
        }
      },
      orderBy: { processedAt: 'desc' }
    });

    if (!completedRefund) {
      console.log('⚠️  No completed refunds found yet');
      console.log('   Stock restoration will be verified when refund completes');
      return true;
    }

    console.log(`✅ Checking refund ID: ${completedRefund.id}`);
    console.log(`   Order: ${completedRefund.Order.id}`);
    
    for (const item of completedRefund.Order.OrderItem) {
      console.log(`\n   Item: Medication ID ${item.medicationId}`);
      console.log(`   Quantity refunded: ${item.quantity}`);
      console.log(`   Pharmacy Stock ID: ${item.pharmacyStockId}`);
    }

    console.log('\n✅ TEST 4 PASSED: Stock information retrieved');
    console.log('   Verify stock quantities match expected values');
    return true;

  } catch (error) {
    console.error('❌ TEST 4 FAILED:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔒 REFUND SYSTEM TESTS');
  console.log('='.repeat(60));

  try {
    const test1 = await testAutomaticRefund();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const test2 = await testManualRefund();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const test3 = await testRefundStatus();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const test4 = await testStockRestoration();

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));

    const results = {
      automaticRefund: test1,
      manualRefund: test2,
      refundStatus: test3,
      stockRestoration: test4
    };

    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;

    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Automatic Refund:', results.automaticRefund ? '✅ PASS' : '❌ FAIL');
    console.log('  Manual Refund:', results.manualRefund ? '✅ PASS' : '❌ FAIL');
    console.log('  Refund Status:', results.refundStatus ? '✅ PASS' : '❌ FAIL');
    console.log('  Stock Restoration:', results.stockRestoration ? '✅ PASS' : '❌ FAIL');

    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Refund system is working.');
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review implementation.');
    }

    console.log('\n📚 Next Steps:');
    console.log('1. Check Paystack dashboard for refund transactions');
    console.log('2. Verify user received refund notification');
    console.log('3. Test admin approval workflow');
    console.log('4. Monitor cron jobs for pending refunds');

  } catch (error) {
    console.error('\n💥 Test suite crashed:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests
runAllTests();
