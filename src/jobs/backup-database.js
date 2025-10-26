/**
 * Database Backup Cron Jobs
 * 
 * Automated backup scheduling with monitoring
 */

const cron = require('node-cron');
const { createBackup, cleanupOldBackups, getBackupStats } = require('../utils/backup-manager');
const { reportError, ErrorCategory } = require('../utils/error-reporter');
const { createAuditLog, AUDIT_ACTIONS, ENTITY_TYPES } = require('../utils/audit-logger');

const TIMEZONE = 'Africa/Lagos';

/**
 * Execute backup with error handling and logging
 */
async function executeBackup(type) {
  const startTime = Date.now();
  
  try {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🔄 Starting ${type.toUpperCase()} backup...`);
    console.log(`${'='.repeat(50)}\n`);
    
    const result = await createBackup(type);
    
    // Log successful backup
    await createAuditLog({
      action: 'DATABASE_BACKUP_COMPLETED',
      entityType: 'System',
      entityId: 0,
      details: {
        type,
        filename: result.filename,
        size: result.sizeInMB,
        duration: result.duration
      }
    }).catch(err => console.warn('Failed to log backup audit:', err));
    
    console.log(`\n✅ ${type.toUpperCase()} backup completed successfully`);
    console.log(`📊 Stats: ${result.sizeInMB} MB in ${result.duration}`);
    
    return result;
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error(`\n❌ ${type.toUpperCase()} backup failed:`, error.message);
    
    // Report error to Sentry
    await reportError(error, {
      category: ErrorCategory.DATABASE,
      context: { type, duration: `${duration}s` }
    });
    
    // Log failed backup
    await createAuditLog({
      action: 'DATABASE_BACKUP_FAILED',
      entityType: 'System',
      entityId: 0,
      details: {
        type,
        error: error.message,
        duration: `${duration}s`
      }
    }).catch(err => console.warn('Failed to log backup failure:', err));
    
    throw error;
  }
}

/**
 * Daily backup job
 */
async function dailyBackup() {
  return executeBackup('daily');
}

/**
 * Weekly backup job
 */
async function weeklyBackup() {
  return executeBackup('weekly');
}

/**
 * Monthly backup job
 */
async function monthlyBackup() {
  return executeBackup('monthly');
}

/**
 * Cleanup job
 */
async function cleanupJob() {
  try {
    console.log('\n🧹 Running backup cleanup...');
    
    const result = await cleanupOldBackups();
    
    console.log(`✅ Cleanup completed: ${result.deletedCount} backups removed`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    
    await reportError(error, {
      category: ErrorCategory.DATABASE,
      context: { job: 'cleanup' }
    });
  }
}

/**
 * Backup monitoring job
 */
async function monitorBackups() {
  try {
    const stats = await getBackupStats();
    
    console.log('\n📊 Backup Statistics:');
    console.log(`   Total backups: ${stats.total}`);
    console.log(`   Daily: ${stats.byType.daily || 0}`);
    console.log(`   Weekly: ${stats.byType.weekly || 0}`);
    console.log(`   Monthly: ${stats.byType.monthly || 0}`);
    console.log(`   Total size: ${stats.totalSizeInMB} MB`);
    
    if (stats.oldest) {
      console.log(`   Oldest: ${stats.oldest.toISOString()}`);
    }
    if (stats.newest) {
      console.log(`   Newest: ${stats.newest.toISOString()}`);
    }
    
    // Alert if no recent backups
    if (stats.newest) {
      const hoursSinceLastBackup = (Date.now() - stats.newest.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastBackup > 48) {
        console.warn(`⚠️  WARNING: Last backup was ${hoursSinceLastBackup.toFixed(1)} hours ago!`);
        
        await reportError(new Error('No recent database backup'), {
          category: ErrorCategory.DATABASE,
          context: { hoursSinceLastBackup: hoursSinceLastBackup.toFixed(1) }
        });
      }
    }
    
    return stats;
    
  } catch (error) {
    console.error('❌ Backup monitoring failed:', error.message);
  }
}

/**
 * Initialize backup cron jobs
 */
function initializeBackupJobs() {
  if (process.env.BACKUP_ENABLED !== 'true') {
    console.log('⚠️  Database backups are disabled (BACKUP_ENABLED=false)');
    return;
  }
  
  console.log('🔄 Initializing database backup jobs...');
  
  // Daily backup at 2 AM
  cron.schedule('0 2 * * *', dailyBackup, {
    timezone: TIMEZONE,
    name: 'daily-backup'
  });
  
  // Weekly backup on Sunday at 3 AM
  cron.schedule('0 3 * * 0', weeklyBackup, {
    timezone: TIMEZONE,
    name: 'weekly-backup'
  });
  
  // Monthly backup on 1st of month at 4 AM
  cron.schedule('0 4 1 * *', monthlyBackup, {
    timezone: TIMEZONE,
    name: 'monthly-backup'
  });
  
  // Cleanup old backups daily at 5 AM
  cron.schedule('0 5 * * *', cleanupJob, {
    timezone: TIMEZONE,
    name: 'backup-cleanup'
  });
  
  // Monitor backups every 6 hours
  cron.schedule('0 */6 * * *', monitorBackups, {
    timezone: TIMEZONE,
    name: 'backup-monitor'
  });
  
  console.log('✅ Database backup jobs initialized');
  console.log('   - Daily backups: 2:00 AM');
  console.log('   - Weekly backups: Sunday 3:00 AM');
  console.log('   - Monthly backups: 1st of month 4:00 AM');
  console.log('   - Cleanup: Daily 5:00 AM');
  console.log('   - Monitoring: Every 6 hours');
}

module.exports = {
  initializeBackupJobs,
  dailyBackup,
  weeklyBackup,
  monthlyBackup,
  cleanupJob,
  monitorBackups
};