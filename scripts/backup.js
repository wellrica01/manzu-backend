#!/usr/bin/env node

/**
 * Manual Backup CLI Tool
 * 
 * Usage:
 *   node scripts/backup.js daily
 *   node scripts/backup.js weekly
 *   node scripts/backup.js monthly
 *   node scripts/backup.js list
 *   node scripts/backup.js stats
 */

require('dotenv').config();
const {
  createBackup,
  listBackups,
  getBackupStats,
  cleanupOldBackups
} = require('../src/utils/backup-manager');

const command = process.argv[2] || 'daily';

async function main() {
  try {
    switch (command) {
      case 'daily':
      case 'weekly':
      case 'monthly':
        await createBackup(command);
        break;
        
      case 'list':
        // List backups from all types
        const types = ['daily', 'weekly', 'monthly'];
        const allBackups = [];
        
        for (const type of types) {
          const typeBackups = await listBackups(type);
          allBackups.push(...typeBackups.map(b => ({
            type,
            name: b.name,
            size: `${(b.metadata?.size / (1024 * 1024)).toFixed(2)} MB`,
            created: new Date(b.created_at).toLocaleString(),
            path: `${type}/${b.name}`
          })));
        }
        
        if (allBackups.length === 0) {
          console.log('\n📋 No backups found');
        } else {
          console.log('\n📋 Available Backups:');
          console.table(allBackups);
          console.log('\n💡 To download: node scripts/restore.js download <path>');
          console.log('   Example: node scripts/restore.js download daily/backup-daily-2025-10-26T11-30-38-309Z.sql.gz');
        }
        break;
        
      case 'stats':
        const stats = await getBackupStats();
        console.log('\n📊 Backup Statistics:');
        console.log(JSON.stringify(stats, null, 2));
        break;
        
      case 'cleanup':
        await cleanupOldBackups();
        break;
        
      default:
        console.log('Usage: node scripts/backup.js [daily|weekly|monthly|list|stats|cleanup]');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  }
}

main();