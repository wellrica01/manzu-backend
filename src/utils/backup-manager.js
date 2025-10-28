/**
 * Database Backup Manager
 * 
 * Handles automated PostgreSQL backups with cloud storage
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { reportError, ErrorCategory } = require('./error-reporter');



const execAsync = promisify(exec);

// Initialize Supabase client for backup storage
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BACKUP_DIR = path.join(__dirname, '../../backups');
const BACKUP_BUCKET = process.env.BACKUP_BUCKET_NAME || 'manzu-database-backups';

/**
 * Ensure backup directory exists
 */
async function ensureBackupDir() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create backup directory:', error);
    throw error;
  }
}

/**
 * Parse DATABASE_URL to get connection details
 */
function parseDatabaseUrl(url) {
  if (!url) {
    throw new Error('DATABASE_URL is not defined');
  }
  
  try {
    // Handle both postgresql:// and postgres:// protocols
    const urlObj = new URL(url.replace(/^postgres:\/\//, 'postgresql://'));
    
    // Extract database name (remove query parameters if present)
    const database = urlObj.pathname.substring(1).split('?')[0];
    
    if (!database) {
      throw new Error('Database name not found in URL');
    }
    
    return {
      user: urlObj.username || 'postgres',
      password: decodeURIComponent(urlObj.password || ''),
      host: urlObj.hostname || 'localhost',
      port: urlObj.port || '5432',
      database: database
    };
  } catch (error) {
    console.error('Failed to parse DATABASE_URL:', error.message);
    console.error('DATABASE_URL format should be: postgresql://user:password@host:port/database');
    throw new Error(`Invalid DATABASE_URL format: ${error.message}`);
  }
}

/**
 * Create database backup using pg_dump
 * 
 * @param {string} type - Backup type: 'daily', 'weekly', 'monthly'
 * @returns {Promise<Object>} Backup metadata
 */
async function createBackup(type = 'daily') {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Starting ${type} database backup...`);
    
    await ensureBackupDir();
    
    // Parse database connection
    const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL);
    
    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${type}-${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);
    
    // Set PGPASSWORD environment variable for pg_dump
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password
    };
    
    // Execute pg_dump with compression
    const dumpCommand = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} --format=custom --compress=9 -f "${filepath}"`;
    
    await execAsync(dumpCommand, { env, maxBuffer: 1024 * 1024 * 100 }); // 100MB buffer
    
    // Get file size
    const stats = await fs.stat(filepath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`✅ Backup created: ${filename} (${sizeInMB} MB)`);
    
    // Upload to cloud storage
    const uploadResult = await uploadBackup(filepath, filename, type);
    
    // Clean up local file after successful upload
    await fs.unlink(filepath);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    const metadata = {
      filename,
      type,
      size: stats.size,
      sizeInMB,
      duration: `${duration}s`,
      timestamp: new Date().toISOString(),
      cloudPath: uploadResult.path,
      success: true
    };
    
    console.log(`✅ Backup completed in ${duration}s`);
    
    return metadata;
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error('❌ Backup failed:', error.message);
    
    await reportError(error, {
      category: ErrorCategory.DATABASE,
      context: { type, duration: `${duration}s` }
    });
    
    throw error;
  }
}

/**
 * Upload backup to Supabase Storage
 */
async function uploadBackup(filepath, filename, type) {
  try {
    console.log(`☁️  Uploading backup to cloud storage...`);
    
    // Read file
    const fileBuffer = await fs.readFile(filepath);
    
    // Upload to Supabase Storage
    const storagePath = `${type}/${filename}`;
    
    const { data, error } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: 'application/gzip',
        upsert: false
      });
    
    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
    
    console.log(`✅ Backup uploaded to: ${storagePath}`);
    
    return { path: storagePath, ...data };
    
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    throw error;
  }
}

/**
 * List all backups in cloud storage
 */
async function listBackups(type = null) {
  try {
    const prefix = type ? `${type}/` : '';
    
    const { data, error } = await supabase.storage
      .from(BACKUP_BUCKET)
      .list(prefix, {
        sortBy: { column: 'created_at', order: 'desc' }
      });
    
    if (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
    
    return data;
    
  } catch (error) {
    console.error('Failed to list backups:', error);
    throw error;
  }
}

/**
 * Download backup from cloud storage
 */
async function downloadBackup(cloudPath, localPath) {
  try {
    console.log(`⬇️  Downloading backup: ${cloudPath}`);
    
    const { data, error } = await supabase.storage
      .from(BACKUP_BUCKET)
      .download(cloudPath);
    
    if (error) {
      throw new Error(`Download failed: ${error.message}`);
    }
    
    // Convert blob to buffer and save
    const buffer = Buffer.from(await data.arrayBuffer());
    await fs.writeFile(localPath, buffer);
    
    console.log(`✅ Backup downloaded to: ${localPath}`);
    
    return localPath;
    
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
}

/**
 * Restore database from backup file
 */
async function restoreBackup(backupPath) {
  try {
    console.log(`🔄 Restoring database from: ${backupPath}`);
    
    // Parse database connection
    const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL);
    
    // Set PGPASSWORD environment variable
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password
    };
    
    // Execute pg_restore
    const restoreCommand = `pg_restore -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} --clean --if-exists "${backupPath}"`;
    
    await execAsync(restoreCommand, { env, maxBuffer: 1024 * 1024 * 100 });
    
    console.log('✅ Database restored successfully');
    
    return { success: true };
    
  } catch (error) {
    console.error('❌ Restore failed:', error.message);
    throw error;
  }
}

/**
 * Clean up old backups based on retention policy
 */
async function cleanupOldBackups() {
  try {
    console.log('🧹 Cleaning up old backups...');
    
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const types = ['daily', 'weekly', 'monthly'];
    let deletedCount = 0;
    
    for (const type of types) {
      const backups = await listBackups(type);
      
      for (const backup of backups) {
        const backupDate = new Date(backup.created_at);
        
        // Keep monthly backups forever, weekly for 90 days, daily for retention period
        const shouldDelete = 
          (type === 'daily' && backupDate < cutoffDate) ||
          (type === 'weekly' && backupDate < new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
        
        if (shouldDelete) {
          const { error } = await supabase.storage
            .from(BACKUP_BUCKET)
            .remove([`${type}/${backup.name}`]);
          
          if (!error) {
            deletedCount++;
            console.log(`🗑️  Deleted old backup: ${backup.name}`);
          }
        }
      }
    }
    
    console.log(`✅ Cleanup completed: ${deletedCount} old backups deleted`);
    
    return { deletedCount };
    
  } catch (error) {
    console.error('Cleanup failed:', error);
    throw error;
  }
}

/**
 * Verify backup integrity
 */
async function verifyBackup(backupPath) {
  try {
    console.log(`🔍 Verifying backup: ${backupPath}`);
    
    // Check if file exists and is readable
    const stats = await fs.stat(backupPath);
    
    if (stats.size === 0) {
      throw new Error('Backup file is empty');
    }
    
    // Parse database connection
    const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL);
    
    // Set PGPASSWORD environment variable
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password
    };
    
    // Test backup file by listing contents
    const listCommand = `pg_restore --list "${backupPath}"`;
    
    await execAsync(listCommand, { env });
    
    console.log('✅ Backup verification passed');
    
    return { valid: true, size: stats.size };
    
  } catch (error) {
    console.error('❌ Backup verification failed:', error.message);
    return { valid: false, error: error.message };
  }
}

/**
 * Get backup statistics
 */
async function getBackupStats() {
  try {
    const types = ['daily', 'weekly', 'monthly'];
    const stats = {
      total: 0,
      byType: {},
      totalSize: 0,
      oldest: null,
      newest: null
    };
    
    for (const type of types) {
      const backups = await listBackups(type);
      stats.byType[type] = backups.length;
      stats.total += backups.length;
      
      for (const backup of backups) {
        stats.totalSize += backup.metadata?.size || 0;
        
        const backupDate = new Date(backup.created_at);
        if (!stats.oldest || backupDate < stats.oldest) {
          stats.oldest = backupDate;
        }
        if (!stats.newest || backupDate > stats.newest) {
          stats.newest = backupDate;
        }
      }
    }
    
    stats.totalSizeInMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
    
    return stats;
    
  } catch (error) {
    console.error('Failed to get backup stats:', error);
    throw error;
  }
}

module.exports = {
  createBackup,
  listBackups,
  downloadBackup,
  restoreBackup,
  cleanupOldBackups,
  verifyBackup,
  getBackupStats,
  BACKUP_DIR
};