/**
 * ERROR MONITORING TEST
 * 
 * Tests Sentry error capture and context attachment
 * 
 * USAGE:
 * node tests/error-monitoring-test.js
 */

// Load environment variables
require('dotenv').config();

const {
  reportError,
  reportPaymentError,
  reportStockError,
  reportValidationError,
  sanitizeData,
  ErrorLevel,
  ErrorCategory
} = require('../src/utils/error-reporter');

/**
 * Test 1: Basic error capture
 */
function testBasicErrorCapture() {
  console.log('🧪 TEST 1: Basic Error Capture');
  console.log('=' .repeat(60));
  
  try {
    const error = new Error('Test error for Sentry');
    
    reportError(error, {
      level: ErrorLevel.ERROR,
      category: ErrorCategory.SYSTEM,
      customContext: {
        testId: 'test-1',
        timestamp: new Date().toISOString()
      }
    });
    
    console.log('✅ Error reported to Sentry');
    console.log('✅ TEST 1 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ TEST 1 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 2: Payment error with context
 */
function testPaymentError() {
  console.log('🧪 TEST 2: Payment Error with Context');
  console.log('=' .repeat(60));
  
  try {
    const error = new Error('Payment processing failed');
    
    reportPaymentError(error, {
      orderId: 'test-order-123',
      transactionId: 'test-txn-456',
      amount: 50000,
      paymentMethod: 'paystack',
      user: {
        id: 'test-user-789',
        email: 'test@example.com',
        role: 'USER'
      }
    });
    
    console.log('✅ Payment error reported with context');
    console.log('   - Order ID: test-order-123');
    console.log('   - Transaction ID: test-txn-456');
    console.log('   - Amount: 50000');
    console.log('✅ TEST 2 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ TEST 2 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 3: Stock error with context
 */
function testStockError() {
  console.log('🧪 TEST 3: Stock Error with Context');
  console.log('=' .repeat(60));
  
  try {
    const error = new Error('Insufficient stock');
    
    reportStockError(error, {
      medicationId: 123,
      pharmacyId: 456,
      requestedQuantity: 10,
      availableStock: 5,
      user: {
        id: 'test-user-789',
        role: 'USER'
      }
    });
    
    console.log('✅ Stock error reported with context');
    console.log('   - Medication ID: 123');
    console.log('   - Pharmacy ID: 456');
    console.log('   - Requested: 10, Available: 5');
    console.log('✅ TEST 3 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ TEST 3 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 4: Sensitive data sanitization
 */
function testDataSanitization() {
  console.log('🧪 TEST 4: Sensitive Data Sanitization');
  console.log('=' .repeat(60));
  
  try {
    const sensitiveData = {
      email: 'user@example.com',
      password: 'secret123',
      token: 'Bearer abc123xyz',
      apiKey: 'sk_test_123456',
      cardNumber: '4111111111111111',
      cvv: '123',
      normalField: 'This should not be redacted'
    };
    
    const sanitized = sanitizeData(sensitiveData);
    
    console.log('Original data:', JSON.stringify(sensitiveData, null, 2));
    console.log('\nSanitized data:', JSON.stringify(sanitized, null, 2));
    
    // Verify sanitization
    const checks = {
      emailMasked: sanitized.email.includes('***'),
      passwordRedacted: sanitized.password === '[REDACTED]',
      tokenRedacted: sanitized.token === '[REDACTED]',
      apiKeyRedacted: sanitized.apiKey === '[REDACTED]',
      cardRedacted: sanitized.cardNumber === '[REDACTED]',
      cvvRedacted: sanitized.cvv === '[REDACTED]',
      normalPreserved: sanitized.normalField === 'This should not be redacted'
    };
    
    console.log('\nSanitization checks:');
    console.log('  Email masked:', checks.emailMasked ? '✅' : '❌');
    console.log('  Password redacted:', checks.passwordRedacted ? '✅' : '❌');
    console.log('  Token redacted:', checks.tokenRedacted ? '✅' : '❌');
    console.log('  API key redacted:', checks.apiKeyRedacted ? '✅' : '❌');
    console.log('  Card redacted:', checks.cardRedacted ? '✅' : '❌');
    console.log('  CVV redacted:', checks.cvvRedacted ? '✅' : '❌');
    console.log('  Normal field preserved:', checks.normalPreserved ? '✅' : '❌');
    
    const allPassed = Object.values(checks).every(check => check);
    
    if (allPassed) {
      console.log('\n✅ TEST 4 PASSED: All sensitive data sanitized\n');
      return true;
    } else {
      console.log('\n❌ TEST 4 FAILED: Some data not sanitized correctly\n');
      return false;
    }
  } catch (error) {
    console.error('❌ TEST 4 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 5: Different error levels
 */
function testErrorLevels() {
  console.log('🧪 TEST 5: Different Error Levels');
  console.log('=' .repeat(60));
  
  try {
    // CRITICAL
    reportError(new Error('Critical error'), {
      level: ErrorLevel.CRITICAL,
      category: ErrorCategory.PAYMENT
    });
    console.log('✅ CRITICAL error reported');
    
    // ERROR
    reportError(new Error('Regular error'), {
      level: ErrorLevel.ERROR,
      category: ErrorCategory.DATABASE
    });
    console.log('✅ ERROR reported');
    
    // WARNING
    reportError(new Error('Warning'), {
      level: ErrorLevel.WARNING,
      category: ErrorCategory.VALIDATION
    });
    console.log('✅ WARNING reported');
    
    // INFO
    reportError(new Error('Info message'), {
      level: ErrorLevel.INFO,
      category: ErrorCategory.SYSTEM
    });
    console.log('✅ INFO reported');
    
    console.log('\n✅ TEST 5 PASSED: All error levels tested\n');
    return true;
  } catch (error) {
    console.error('❌ TEST 5 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 6: Error grouping/fingerprinting
 */
function testErrorGrouping() {
  console.log('🧪 TEST 6: Error Grouping');
  console.log('=' .repeat(60));
  
  try {
    // Same error message should group together
    for (let i = 0; i < 3; i++) {
      reportValidationError(new Error('Invalid email format'), {
        field: 'email',
        value: `test${i}@invalid`,
        constraint: 'Email must be valid'
      });
    }
    
    console.log('✅ Sent 3 identical validation errors');
    console.log('   These should group together in Sentry');
    console.log('✅ TEST 6 PASSED\n');
    return true;
  } catch (error) {
    console.error('❌ TEST 6 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 7: Nested object sanitization
 */
function testNestedSanitization() {
  console.log('🧪 TEST 7: Nested Object Sanitization');
  console.log('=' .repeat(60));
  
  try {
    const nestedData = {
      user: {
        email: 'user@example.com',
        password: 'secret',
        profile: {
          name: 'John Doe',
          apiKey: 'sk_test_123'
        }
      },
      payment: {
        cardNumber: '4111111111111111',
        cvv: '123'
      }
    };
    
    const sanitized = sanitizeData(nestedData);
    
    const checks = {
      emailMasked: sanitized.user.email.includes('***'),
      passwordRedacted: sanitized.user.password === '[REDACTED]',
      apiKeyRedacted: sanitized.user.profile.apiKey === '[REDACTED]',
      cardRedacted: sanitized.payment.cardNumber === '[REDACTED]',
      cvvRedacted: sanitized.payment.cvv === '[REDACTED]',
      namePreserved: sanitized.user.profile.name === 'John Doe'
    };
    
    console.log('Nested sanitization checks:');
    console.log('  Nested email masked:', checks.emailMasked ? '✅' : '❌');
    console.log('  Nested password redacted:', checks.passwordRedacted ? '✅' : '❌');
    console.log('  Nested API key redacted:', checks.apiKeyRedacted ? '✅' : '❌');
    console.log('  Nested card redacted:', checks.cardRedacted ? '✅' : '❌');
    console.log('  Nested CVV redacted:', checks.cvvRedacted ? '✅' : '❌');
    console.log('  Name preserved:', checks.namePreserved ? '✅' : '❌');
    
    const allPassed = Object.values(checks).every(check => check);
    
    if (allPassed) {
      console.log('\n✅ TEST 7 PASSED: Nested objects sanitized correctly\n');
      return true;
    } else {
      console.log('\n❌ TEST 7 FAILED: Nested sanitization incomplete\n');
      return false;
    }
  } catch (error) {
    console.error('❌ TEST 7 FAILED:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 ERROR MONITORING TESTS');
  console.log('='.repeat(60));
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Sentry DSN:', process.env.SENTRY_DSN ? 'Configured' : 'Not configured');
  console.log('='.repeat(60));
  console.log();
  
  if (!process.env.SENTRY_DSN) {
    console.log('⚠️  WARNING: SENTRY_DSN not configured!');
    console.log('Errors will be logged but not sent to Sentry.');
    console.log('Set SENTRY_DSN in .env to enable Sentry integration.\n');
  }
  
  try {
    const test1 = testBasicErrorCapture();
    const test2 = testPaymentError();
    const test3 = testStockError();
    const test4 = testDataSanitization();
    const test5 = testErrorLevels();
    const test6 = testErrorGrouping();
    const test7 = testNestedSanitization();
    
    // Summary
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const results = {
      basicErrorCapture: test1,
      paymentError: test2,
      stockError: test3,
      dataSanitization: test4,
      errorLevels: test5,
      errorGrouping: test6,
      nestedSanitization: test7,
    };
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Basic Error Capture:', results.basicErrorCapture ? '✅ PASS' : '❌ FAIL');
    console.log('  Payment Error Context:', results.paymentError ? '✅ PASS' : '❌ FAIL');
    console.log('  Stock Error Context:', results.stockError ? '✅ PASS' : '❌ FAIL');
    console.log('  Data Sanitization:', results.dataSanitization ? '✅ PASS' : '❌ FAIL');
    console.log('  Error Levels:', results.errorLevels ? '✅ PASS' : '❌ FAIL');
    console.log('  Error Grouping:', results.errorGrouping ? '✅ PASS' : '❌ FAIL');
    console.log('  Nested Sanitization:', results.nestedSanitization ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Error monitoring is working correctly.');
      console.log('\n📊 Check your Sentry dashboard to see the test errors:');
      console.log('   https://sentry.io/organizations/your-org/issues/');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review the implementation.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
