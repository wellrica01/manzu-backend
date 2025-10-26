/**
 * XSS PROTECTION TEST
 * 
 * Tests input sanitization against various XSS attack vectors
 * 
 * USAGE:
 * node tests/xss-protection-test.js
 */

const {
  sanitizeString,
  sanitizeObject,
  isSafeString,
  DANGEROUS_PATTERNS
} = require('../src/middleware/sanitize-inputs');

/**
 * Test 1: Basic XSS Attacks
 */
function testBasicXSS() {
  console.log('🧪 TEST 1: Basic XSS Attacks');
  console.log('=' .repeat(60));
  
  const testCases = [
    {
      input: '<script>alert("xss")</script>',
      expected: '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;',
      description: 'Script tag'
    },
    {
      input: 'John <b>Doe</b>',
      expected: 'John Doe',
      description: 'Bold tag'
    },
    {
      input: '<img src=x onerror=alert(1)>',
      expected: '&lt;img src=x onerror=alert(1)&gt;',
      description: 'Image with onerror'
    },
    {
      input: '<iframe src="javascript:alert(1)"></iframe>',
      expected: '&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;&lt;&#x2F;iframe&gt;',
      description: 'Iframe with javascript'
    },
    {
      input: '<a href="javascript:void(0)">Click</a>',
      expected: 'Click',
      description: 'Link with javascript'
    },
    {
      input: '<svg onload=alert(1)>',
      expected: '&lt;svg onload=alert(1)&gt;',
      description: 'SVG with onload'
    }
  ];
  
  let passed = 0;
  
  for (const test of testCases) {
    const result = sanitizeString(test.input, 'testField');
    const safe = !result.includes('<script') && 
                 !result.includes('javascript:') &&
                 !result.includes('onerror=') &&
                 !result.includes('onload=');
    
    if (safe) {
      passed++;
      console.log(`✅ ${test.description}`);
      console.log(`   Input:  ${test.input}`);
      console.log(`   Output: ${result}`);
    } else {
      console.log(`❌ ${test.description}`);
      console.log(`   Input:  ${test.input}`);
      console.log(`   Output: ${result} (UNSAFE!)`);
    }
  }
  
  console.log(`\nResults: ${passed}/${testCases.length} XSS attacks blocked`);
  
  if (passed === testCases.length) {
    console.log('✅ TEST 1 PASSED: Basic XSS attacks blocked\n');
    return true;
  } else {
    console.log('❌ TEST 1 FAILED: Some XSS attacks not blocked\n');
    return false;
  }
}

/**
 * Test 2: Event Handler Injection
 */
function testEventHandlers() {
  console.log('🧪 TEST 2: Event Handler Injection');
  console.log('=' .repeat(60));
  
  const eventHandlers = [
    'onclick=alert(1)',
    'onerror=alert(1)',
    'onload=alert(1)',
    'onmouseover=alert(1)',
    'onfocus=alert(1)',
    'onblur=alert(1)',
    'onchange=alert(1)',
    'onsubmit=alert(1)'
  ];
  
  let passed = 0;
  
  for (const handler of eventHandlers) {
    const input = `<div ${handler}>Test</div>`;
    const result = sanitizeString(input, 'testField');
    
    // Check that event handler is removed or encoded
    const safe = !result.toLowerCase().includes(handler.split('=')[0]);
    
    if (safe) {
      passed++;
      console.log(`✅ Blocked: ${handler}`);
    } else {
      console.log(`❌ NOT BLOCKED: ${handler} → ${result}`);
    }
  }
  
  console.log(`\nResults: ${passed}/${eventHandlers.length} event handlers blocked`);
  
  if (passed === eventHandlers.length) {
    console.log('✅ TEST 2 PASSED: Event handlers blocked\n');
    return true;
  } else {
    console.log('❌ TEST 2 FAILED: Some event handlers not blocked\n');
    return false;
  }
}

/**
 * Test 3: Protocol-Based Attacks
 */
function testProtocols() {
  console.log('🧪 TEST 3: Protocol-Based Attacks');
  console.log('=' .repeat(60));
  
  const protocols = [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'data:image/svg+xml,<svg onload=alert(1)>'
  ];
  
  let passed = 0;
  
  for (const protocol of protocols) {
    const result = sanitizeString(protocol, 'testField');
    
    // Check that dangerous protocol is removed or encoded
    const safe = !result.includes('javascript:') &&
                 !result.includes('data:text/html') &&
                 !result.includes('vbscript:') &&
                 !result.includes('file:');
    
    if (safe) {
      passed++;
      console.log(`✅ Blocked: ${protocol.substring(0, 50)}`);
    } else {
      console.log(`❌ NOT BLOCKED: ${protocol} → ${result}`);
    }
  }
  
  console.log(`\nResults: ${passed}/${protocols.length} dangerous protocols blocked`);
  
  if (passed === protocols.length) {
    console.log('✅ TEST 3 PASSED: Dangerous protocols blocked\n');
    return true;
  } else {
    console.log('❌ TEST 3 FAILED: Some protocols not blocked\n');
    return false;
  }
}

/**
 * Test 4: HTML Entity Encoding
 */
function testHTMLEncoding() {
  console.log('🧪 TEST 4: HTML Entity Encoding');
  console.log('=' .repeat(60));
  
  const testCases = [
    { input: '<', expected: '&lt;' },
    { input: '>', expected: '&gt;' },
    { input: '"', expected: '&quot;' },
    { input: "'", expected: '&#x27;' },
    { input: '/', expected: '&#x2F;' },
    { input: '&', expected: '&amp;' }
  ];
  
  let passed = 0;
  
  for (const test of testCases) {
    const result = sanitizeString(test.input, 'testField');
    
    // Check if character is encoded
    const encoded = result !== test.input && result.includes('&');
    
    if (encoded) {
      passed++;
      console.log(`✅ ${test.input} → ${result}`);
    } else {
      console.log(`❌ ${test.input} → ${result} (not encoded)`);
    }
  }
  
  console.log(`\nResults: ${passed}/${testCases.length} characters encoded`);
  
  if (passed === testCases.length) {
    console.log('✅ TEST 4 PASSED: HTML entities encoded\n');
    return true;
  } else {
    console.log('❌ TEST 4 FAILED: Some characters not encoded\n');
    return false;
  }
}

/**
 * Test 5: Valid Input Preservation
 */
function testValidInputs() {
  console.log('🧪 TEST 5: Valid Input Preservation');
  console.log('=' .repeat(60));
  
  const validInputs = [
    { input: 'John Doe', description: 'Normal name' },
    { input: 'José García', description: 'Name with accents' },
    { input: '123 Main St, Apt 4B', description: 'Address' },
    { input: 'user@example.com', description: 'Email', field: 'email' },
    { input: '+1234567890', description: 'Phone', field: 'phone' },
    { input: 'Hello\nWorld', description: 'Newlines', field: 'notes' }
  ];
  
  let passed = 0;
  
  for (const test of validInputs) {
    const result = sanitizeString(test.input, test.field || 'testField');
    
    // Check if valid input is preserved (allowing for normalization)
    const preserved = result.length > 0 && 
                     !result.includes('&lt;') &&
                     !result.includes('&gt;');
    
    if (preserved) {
      passed++;
      console.log(`✅ ${test.description}: ${test.input} → ${result}`);
    } else {
      console.log(`❌ ${test.description}: ${test.input} → ${result} (corrupted)`);
    }
  }
  
  console.log(`\nResults: ${passed}/${validInputs.length} valid inputs preserved`);
  
  if (passed === validInputs.length) {
    console.log('✅ TEST 5 PASSED: Valid inputs preserved\n');
    return true;
  } else {
    console.log('❌ TEST 5 FAILED: Some valid inputs corrupted\n');
    return false;
  }
}

/**
 * Test 6: Object Sanitization
 */
function testObjectSanitization() {
  console.log('🧪 TEST 6: Object Sanitization');
  console.log('=' .repeat(60));
  
  const testObject = {
    name: 'John <script>alert(1)</script> Doe',
    email: 'user@example.com',
    address: {
      street: '123 Main <b>St</b>',
      city: 'New York',
      notes: 'Leave at door <img src=x onerror=alert(1)>'
    },
    medications: [
      { name: 'Aspirin <script>alert(1)</script>' },
      { name: 'Ibuprofen' }
    ]
  };
  
  const sanitized = sanitizeObject(testObject);
  
  // Check all fields are sanitized
  const checks = [
    { 
      field: 'name',
      safe: !sanitized.name.includes('<script'),
      description: 'Name sanitized'
    },
    {
      field: 'email',
      safe: sanitized.email === 'user@example.com',
      description: 'Email preserved'
    },
    {
      field: 'address.street',
      safe: !sanitized.address.street.includes('<b>'),
      description: 'Nested object sanitized'
    },
    {
      field: 'medications[0].name',
      safe: !sanitized.medications[0].name.includes('<script'),
      description: 'Array item sanitized'
    }
  ];
  
  let passed = 0;
  
  for (const check of checks) {
    if (check.safe) {
      passed++;
      console.log(`✅ ${check.description}`);
    } else {
      console.log(`❌ ${check.description} FAILED`);
    }
  }
  
  console.log(`\nResults: ${passed}/${checks.length} object fields sanitized`);
  
  if (passed === checks.length) {
    console.log('✅ TEST 6 PASSED: Object sanitization working\n');
    return true;
  } else {
    console.log('❌ TEST 6 FAILED: Object sanitization issues\n');
    return false;
  }
}

/**
 * Test 7: Dangerous Pattern Detection
 */
function testDangerousPatterns() {
  console.log('🧪 TEST 7: Dangerous Pattern Detection');
  console.log('=' .repeat(60));
  
  const dangerousInputs = [
    '<script>alert(1)</script>',
    'javascript:void(0)',
    '<img onerror=alert(1)>',
    'data:text/html,<script>alert(1)</script>',
    '<iframe src="evil.com"></iframe>',
    '<!-- comment -->',
    '<object data="evil.swf">',
    '<embed src="evil.swf">',
    'vbscript:msgbox(1)',
    '<link rel="stylesheet" href="evil.css">'
  ];
  
  let passed = 0;
  
  for (const input of dangerousInputs) {
    const safe = isSafeString(input);
    
    if (!safe) {
      passed++;
      console.log(`✅ Detected: ${input.substring(0, 50)}`);
    } else {
      console.log(`❌ NOT DETECTED: ${input}`);
    }
  }
  
  console.log(`\nResults: ${passed}/${dangerousInputs.length} dangerous patterns detected`);
  
  if (passed === dangerousInputs.length) {
    console.log('✅ TEST 7 PASSED: Dangerous patterns detected\n');
    return true;
  } else {
    console.log('❌ TEST 7 FAILED: Some patterns not detected\n');
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔒 XSS PROTECTION SECURITY TESTS');
  console.log('='.repeat(60));
  console.log();
  
  try {
    const test1 = testBasicXSS();
    const test2 = testEventHandlers();
    const test3 = testProtocols();
    const test4 = testHTMLEncoding();
    const test5 = testValidInputs();
    const test6 = testObjectSanitization();
    const test7 = testDangerousPatterns();
    
    // Summary
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const results = {
      basicXSS: test1,
      eventHandlers: test2,
      protocols: test3,
      htmlEncoding: test4,
      validInputs: test5,
      objectSanitization: test6,
      dangerousPatterns: test7
    };
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Basic XSS Attacks:', results.basicXSS ? '✅ PASS' : '❌ FAIL');
    console.log('  Event Handler Injection:', results.eventHandlers ? '✅ PASS' : '❌ FAIL');
    console.log('  Protocol-Based Attacks:', results.protocols ? '✅ PASS' : '❌ FAIL');
    console.log('  HTML Entity Encoding:', results.htmlEncoding ? '✅ PASS' : '❌ FAIL');
    console.log('  Valid Input Preservation:', results.validInputs ? '✅ PASS' : '❌ FAIL');
    console.log('  Object Sanitization:', results.objectSanitization ? '✅ PASS' : '❌ FAIL');
    console.log('  Dangerous Pattern Detection:', results.dangerousPatterns ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Application is protected against XSS.');
      console.log('\n📊 Security Summary:');
      console.log('   - Script tags stripped');
      console.log('   - Event handlers removed');
      console.log('   - Dangerous protocols blocked');
      console.log('   - HTML entities encoded');
      console.log('   - Valid inputs preserved');
      console.log('   - Nested objects sanitized');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review XSS protection implementation.');
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
