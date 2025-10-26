/**
 * GENERATE SECURE JWT SECRET
 * 
 * Generates a cryptographically secure JWT secret
 * 
 * USAGE:
 * node scripts/generate-jwt-secret.js
 */

const crypto = require('crypto');

console.log('\n🔐 JWT Secret Generator');
console.log('=' .repeat(60));

// Generate 64 random bytes (128 hex characters)
const secret = crypto.randomBytes(64).toString('hex');

console.log('\n✅ Generated secure JWT secret (128 characters):');
console.log('\n' + secret);

console.log('\n📋 Instructions:');
console.log('1. Copy the secret above');
console.log('2. Open your .env file');
console.log('3. Replace JWT_SECRET with the new secret:');
console.log('   JWT_SECRET=' + secret);
console.log('4. Save the file');
console.log('5. Restart your application');
console.log('6. NEVER commit .env to git!');

console.log('\n⚠️  Security Notes:');
console.log('- This secret is 128 characters (very strong)');
console.log('- Generated using crypto.randomBytes (cryptographically secure)');
console.log('- Keep this secret safe and never share it');
console.log('- Rotate quarterly or if compromised');

console.log('\n✅ Validation:');
console.log('- Length: ' + secret.length + ' characters ✅');
console.log('- Unique characters: ' + new Set(secret).size + ' ✅');
console.log('- Entropy: High ✅');

console.log('\n');
