/**
 * SECURE FILE UPLOAD UTILITY (Enhanced)
 * 
 * Comprehensive security for all file uploads (PDFs, images)
 * Features:
 * - Magic byte validation (prevents renamed executables)
 * - File size limits per type
 * - Content verification
 * - Filename sanitization
 * - Malware prevention
 */

const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const { fileTypeFromBuffer } = require('file-type');

/**
 * File type configurations with size limits and allowed types
 */
const FILE_CONFIGS = {
  PDF: {
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    maxSize: 5 * 1024 * 1024, // 5MB
    magicBytes: [
      [0x25, 0x50, 0x44, 0x46] // %PDF
    ]
  },
  IMAGE: {
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png'],
    extensions: ['.jpg', '.jpeg', '.png'],
    maxSize: 2 * 1024 * 1024, // 2MB
    magicBytes: {
      jpeg: [
        [0xFF, 0xD8, 0xFF, 0xE0], // JPEG JFIF
        [0xFF, 0xD8, 0xFF, 0xE1], // JPEG EXIF
        [0xFF, 0xD8, 0xFF, 0xE2],
        [0xFF, 0xD8, 0xFF, 0xE3],
        [0xFF, 0xD8, 0xFF, 0xE8]
      ],
      png: [
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] // PNG
      ]
    }
  }
};

/**
 * Blocked extensions (executables, scripts, archives)
 */
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js',
  '.jar', '.zip', '.rar', '.7z', '.tar', '.gz',
  '.sh', '.bash', '.php', '.asp', '.aspx', '.jsp', '.py', '.rb',
  '.pl', '.cgi', '.dll', '.so', '.dylib',
  '.app', '.deb', '.rpm', '.dmg', '.pkg',
  '.html', '.htm', '.xml', '.svg', '.swf', '.msi'
];

/**
 * Sanitize filename to prevent path traversal and injection
 */
function sanitizeFilename(filename) {
  if (!filename) return 'unknown';
  
  // Remove path traversal
  filename = filename.replace(/\.\./g, '');
  filename = filename.replace(/[\/\\]/g, '');
  
  // Remove special characters
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Remove multiple dots
  filename = filename.replace(/\.+/g, '.');
  
  // Limit length
  if (filename.length > 100) {
    const ext = path.extname(filename);
    filename = filename.substring(0, 100 - ext.length) + ext;
  }
  
  return filename.toLowerCase();
}

/**
 * Generate secure random filename
 */
function generateSecureFilename(originalName, prefix = 'file') {
  const sanitized = sanitizeFilename(originalName);
  const ext = path.extname(sanitized);
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  
  return `${prefix}_${timestamp}_${random}${ext}`;
}

/**
 * Verify file magic bytes
 */
function verifyMagicBytes(buffer, fileType) {
  if (!buffer || buffer.length < 8) {
    return { valid: false, detectedType: null };
  }

  // Check PDF
  if (fileType === 'PDF') {
    const pdfSignature = FILE_CONFIGS.PDF.magicBytes[0];
    let matches = true;
    for (let i = 0; i < pdfSignature.length; i++) {
      if (buffer[i] !== pdfSignature[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { valid: true, detectedType: 'application/pdf' };
    }
  }

  // Check Images
  if (fileType === 'IMAGE') {
    // Check JPEG
    for (const signature of FILE_CONFIGS.IMAGE.magicBytes.jpeg) {
      let matches = true;
      for (let i = 0; i < signature.length; i++) {
        if (buffer[i] !== signature[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return { valid: true, detectedType: 'image/jpeg' };
      }
    }

    // Check PNG
    const pngSignature = FILE_CONFIGS.IMAGE.magicBytes.png[0];
    let pngMatches = true;
    for (let i = 0; i < pngSignature.length; i++) {
      if (buffer[i] !== pngSignature[i]) {
        pngMatches = false;
        break;
      }
    }
    if (pngMatches) {
      return { valid: true, detectedType: 'image/png' };
    }
  }

  return { valid: false, detectedType: null };
}

/**
 * Validate PDF content
 */
async function validatePDFContent(buffer) {
  try {
    // Use file-type to detect actual file type
    const fileType = await fileTypeFromBuffer(buffer);
    
    if (!fileType || fileType.mime !== 'application/pdf') {
      return {
        valid: false,
        error: `File is not a valid PDF. Detected type: ${fileType?.mime || 'unknown'}`
      };
    }

    // Verify magic bytes
    const magicCheck = verifyMagicBytes(buffer, 'PDF');
    if (!magicCheck.valid) {
      return {
        valid: false,
        error: 'PDF signature verification failed. File may be corrupted or malicious.'
      };
    }

    // Check for PDF structure
    const bufferStr = buffer.toString('utf8', 0, Math.min(1024, buffer.length));
    if (!bufferStr.includes('%PDF')) {
      return {
        valid: false,
        error: 'Invalid PDF structure. File may be corrupted.'
      };
    }

    // Check for suspicious content (basic malware detection)
    const suspiciousPatterns = [
      '/JavaScript',
      '/JS',
      '/Launch',
      '/EmbeddedFile',
      '/AA', // Auto-action
      '/OpenAction'
    ];

    for (const pattern of suspiciousPatterns) {
      if (bufferStr.includes(pattern)) {
        console.warn(`⚠️  PDF contains suspicious pattern: ${pattern}`);
        // Log but don't reject - some legitimate PDFs may have these
      }
    }

    return {
      valid: true,
      metadata: {
        size: buffer.length,
        type: 'application/pdf'
      }
    };
  } catch (error) {
    return {
      valid: false,
      error: 'PDF validation failed: ' + error.message
    };
  }
}

/**
 * Validate image content
 */
async function validateImageContent(buffer) {
  try {
    // Use file-type to detect actual file type
    const fileType = await fileTypeFromBuffer(buffer);
    
    if (!fileType || !FILE_CONFIGS.IMAGE.mimeTypes.includes(fileType.mime)) {
      return {
        valid: false,
        error: `File is not a valid image. Detected type: ${fileType?.mime || 'unknown'}`
      };
    }

    // Verify magic bytes
    const magicCheck = verifyMagicBytes(buffer, 'IMAGE');
    if (!magicCheck.valid) {
      return {
        valid: false,
        error: 'Image signature verification failed. File may be corrupted or malicious.'
      };
    }

    // Try to process with sharp (will fail if not a real image)
    try {
      const metadata = await sharp(buffer).metadata();
      
      // Check dimensions
      if (metadata.width > 10000 || metadata.height > 10000) {
        return {
          valid: false,
          error: 'Image dimensions too large. Maximum 10000x10000 pixels.'
        };
      }

      if (metadata.width < 10 || metadata.height < 10) {
        return {
          valid: false,
          error: 'Image dimensions too small. Minimum 10x10 pixels.'
        };
      }

      return {
        valid: true,
        metadata: {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
          size: buffer.length
        }
      };
    } catch (sharpError) {
      return {
        valid: false,
        error: 'Failed to process image. File may be corrupted or contain malicious code.'
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: 'Image validation failed: ' + error.message
    };
  }
}

/**
 * Comprehensive file validation
 */
async function validateFile(file, expectedType = 'ANY') {
  const errors = [];

  if (!file) {
    return { valid: false, errors: ['No file provided'] };
  }

  // Determine file type
  const ext = path.extname(file.originalname).toLowerCase();
  let fileType = null;
  let config = null;

  if (FILE_CONFIGS.PDF.extensions.includes(ext)) {
    fileType = 'PDF';
    config = FILE_CONFIGS.PDF;
  } else if (FILE_CONFIGS.IMAGE.extensions.includes(ext)) {
    fileType = 'IMAGE';
    config = FILE_CONFIGS.IMAGE;
  }

  if (!fileType) {
    return {
      valid: false,
      errors: [`Invalid file extension: ${ext}. Only PDF, JPEG, PNG are allowed.`]
    };
  }

  // Check if expected type matches
  if (expectedType !== 'ANY' && fileType !== expectedType) {
    return {
      valid: false,
      errors: [`Expected ${expectedType} file, got ${fileType}`]
    };
  }

  // Check file size
  if (file.size > config.maxSize) {
    errors.push(
      `File too large. Maximum size for ${fileType}: ${(config.maxSize / 1024 / 1024).toFixed(1)}MB. ` +
      `Your file: ${(file.size / 1024 / 1024).toFixed(2)}MB`
    );
  }

  // Check MIME type
  if (!config.mimeTypes.includes(file.mimetype)) {
    errors.push(`Invalid MIME type: ${file.mimetype}`);
  }

  // Check for blocked extensions
  for (const blocked of BLOCKED_EXTENSIONS) {
    if (file.originalname.toLowerCase().includes(blocked)) {
      errors.push(`Suspicious file detected. Extension ${blocked} is not allowed.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Content validation
  let contentValidation;
  if (fileType === 'PDF') {
    contentValidation = await validatePDFContent(file.buffer);
  } else if (fileType === 'IMAGE') {
    contentValidation = await validateImageContent(file.buffer);
  }

  if (!contentValidation.valid) {
    return {
      valid: false,
      errors: [contentValidation.error]
    };
  }

  return {
    valid: true,
    fileType,
    metadata: contentValidation.metadata,
    sanitizedFilename: sanitizeFilename(file.originalname)
  };
}

/**
 * Multer configuration
 */
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  // Check extension
  const allAllowedExts = [...FILE_CONFIGS.PDF.extensions, ...FILE_CONFIGS.IMAGE.extensions];
  if (!allAllowedExts.includes(ext)) {
    return cb(new Error(`Invalid file extension. Only PDF, JPEG, PNG are allowed.`), false);
  }

  // Check MIME type
  const allAllowedMimes = [...FILE_CONFIGS.PDF.mimeTypes, ...FILE_CONFIGS.IMAGE.mimeTypes];
  if (!allAllowedMimes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type. Only PDF and images are allowed.`), false);
  }

  // Check for blocked extensions
  for (const blocked of BLOCKED_EXTENSIONS) {
    if (file.originalname.toLowerCase().includes(blocked)) {
      return cb(new Error(`Suspicious file detected.`), false);
    }
  }

  // Check for path traversal
  if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
    return cb(new Error(`Invalid filename.`), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max (will be checked per type in validation)
    files: 1
  }
});

module.exports = upload;
module.exports.validateFile = validateFile;
module.exports.generateSecureFilename = generateSecureFilename;
module.exports.sanitizeFilename = sanitizeFilename;
module.exports.FILE_CONFIGS = FILE_CONFIGS;
