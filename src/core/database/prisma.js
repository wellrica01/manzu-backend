/**
 * SINGLE PRISMA CLIENT INSTANCE - OPTIMIZED
 * 
 * Centralized database connection management
 * With connection pool monitoring and better error handling
 */

const { PrismaClient } = require('@prisma/client');

// Create single Prisma instance with optimized configuration
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ]
    : ['error'],
});

// Connection pool monitoring (development only)
if (process.env.NODE_ENV === 'development') {
  prisma.$on('info', (e) => {
    if (e.message.includes('pool') || e.message.includes('connection')) {
      console.log('🔌 Connection info:', e.message);
    }
  });

  prisma.$on('query', (e) => {
    // Log slow queries (> 1 second)
    if (e.duration > 1000) {
      console.warn(`⚠️  Slow query detected (${e.duration}ms):`, e.query.substring(0, 100));
    }
  });
}

// Test connection on startup
prisma.$connect()
  .then(() => {
    console.log('✅ Database connected successfully');
  })
  .catch((error) => {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  });

// Graceful shutdown handlers
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} received. Closing database connections...`);
  try {
    await prisma.$disconnect();
    console.log('✅ Database disconnected gracefully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during disconnect:', error);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

// Export with health check method
module.exports = prisma;

// Optional: Export health check function
module.exports.checkHealth = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', timestamp: new Date() };
  } catch (error) {
    return { status: 'unhealthy', error: error.message, timestamp: new Date() };
  }
};