#!/usr/bin/env node

/**
 * Database Restore CLI Tool
 * 
 * Usage:
 *   node scripts/restore.js list
 *   node scripts/restore.js download daily/backup-daily-2025-10-25.sql.gz
 *   node scripts/restore.js restore ./backups/backup-daily-2025-10-25.sql.gz
 */

require('dotenv').config();
const path = require('path');
const {
  listBackups,
  downloadBackup,
  restoreBackup,
  verifyBackup,
  BACKUP_DIR
} = require('../src/utils/backup-manager');

const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  try {
    switch (command) {
      case 'list':
        const backups = await listBackups();
        console.log('\n📋 Available Backups:');
        console.table(backups.map(b => ({
          path: `${b.name}`,
          size: `${(b.metadata?.size / (1024 * 1024)).toFixed(2)} MB`,
          created: new Date(b.created_at).toLocaleString()
        })));
        break;
        
      case 'download':
        if (!arg) {
          console.error('❌ Please specify backup path');
          console.log('Usage: node scripts/restore.js download daily/backup-daily-2025-10-25.sql.gz');
          process.exit(1);
        }
        
        const filename = path.basename(arg);
        const localPath = path.join(BACKUP_DIR, filename);
        await downloadBackup(arg, localPath);
        console.log(`✅ Downloaded to: ${localPath}`);
        break;
        
      case 'verify':
        if (!arg) {
          console.error('❌ Please specify backup file path');
          process.exit(1);
        }
        
        const verifyResult = await verifyBackup(arg);
        if (verifyResult.valid) {
          console.log('✅ Backup is valid');
        } else {
          console.error('❌ Backup is invalid:', verifyResult.error);
          process.exit(1);
        }
        break;
        
      case 'restore':
        if (!arg) {
          console.error('❌ Please specify backup file path');
          console.log('Usage: node scripts/restore.js restore ./backups/backup-daily-2025-10-25.sql.gz');
          process.exit(1);
        }
        
        console.log('⚠️  WARNING: This will overwrite the current database!');
        console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await restoreBackup(arg);
        console.log('✅ Database restored successfully');
        break;
        
      default:
        console.log('Usage: node scripts/restore.js [list|download|verify|restore] [path]');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Operation failed:', error.message);
    process.exit(1);
  }
}

main();