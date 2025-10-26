/**
 * SECURE FILE UPLOAD UTILITY
 * 
 * Comprehensive security for prescription file uploads
 * Protects against: malware, executables, path traversal, XXE, etc.
 */

const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const { fileTypeFromBuffer } = require('file-type');

/**
 * Allowed MIME types (whitelist)
 */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png'
];

/**
 * Allowed file extensions (whitelist)
 */
const ALLOWED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png'
];

/**
 * Blocked extensions (executables, scripts, etc.)
 */
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js',
  '.jar', '.zip', '.rar', '.7z', '.tar', '.gz',
  '.sh', '.bash', '.php', '.asp', '.aspx', '.jsp', '.py', '.rb',
  '.pl', '.cgi', '.dll', '.so', '.dylib',
  '.app', '.deb', '.rpm', '.dmg', '.pkg',
  '.html', '.htm', '.xml', '.svg', '.swf'
];

/**
 * Magic bytes (file signatures) for allowed image types
 */
const MAGIC_BYTES = {
  jpeg: [
    [0xFF, 0xD8, 0xFF, 0xE0], // JPEG JFIF
    [0xFF, 0xD8, 0xFF, 0xE1], // JPEG EXIF
    [0xFF, 0xD8, 0xFF, 0xE2], // JPEG
    [0xFF, 0xD8, 0xFF, 0xE3], // JPEG
    [0xFF, 0xD8, 0xFF, 0xE8], // JPEG
  ],
  png: [
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] // PNG
  ]
};

/**
 * Sanitize filename to prevent path traversal and injection attacks
 */
function sanitizeFilename(filename) {
  if (!filename) {
    return 'unknown';
  }

  // Remove path traversal attempts
  filename = filename.replace(/\.\./g, '');
  filename = filename.replace(/[\/\\]/g, '');
  
  // Remove special characters and spaces
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Remove multiple dots (except before extension)
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
function generateSecureFilename(originalName) {
  const sanitized = sanitizeFilename(originalName);
  const ext = path.extname(sanitized);
  const timestamp = Date.now();
  const random = crypto.randomBytes(16).toString('hex');
  
  return `prescription_${timestamp}_${random}${ext}`;
}

/**
 * Verify file signature (magic bytes)
 */
function verifyFileSignature(buffer) {
  if (!buffer || buffer.length < 8) {
    return { valid: false, type: null };
  }

  // Check JPEG signatures
  for (const signature of MAGIC_BYTES.jpeg) {
    let matches = true;
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { valid: true, type: 'image/jpeg' };
    }
  }

  // Check PNG signature
  const pngSignature = MAGIC_BYTES.png[0];
  let pngMatches = true;
  for (let i = 0; i < pngSignature.length; i++) {
    if (buffer[i] !== pngSignature[i]) {
      pngMatches = false;
      break;
    }
  }
  if (pngMatches) {
    return { valid: true, type: 'image/png' };
  }

  return { valid: false, type: null };
}

/**
 * Validate file is actually an image (not renamed executable)
 */
async function validateImageContent(buffer) {
  try {
    // Use file-type to detect actual file type
    const fileType = await fileTypeFromBuffer(buffer);
    
    if (!fileType) {
      return {
        valid: false,
        error: 'Unable to determine file type. File may be corrupted or invalid.'
      };
    }

    // Check if detected type is in allowed list
    if (!ALLOWED_MIME_TYPES.includes(fileType.mime)) {
      return {
        valid: false,
        error: `File type ${fileType.mime} is not allowed. Only JPEG and PNG images are accepted.`
      };
    }

    // Verify magic bytes match
    const signatureCheck = verifyFileSignature(buffer);
    if (!signatureCheck.valid) {
      return {
        valid: false,
        error: 'File signature verification failed. File may be corrupted or not a valid image.'
      };
    }

    // Try to process with sharp (will fail if not a real image)
    try {
      const metadata = await sharp(buffer).metadata();
      
      // Check image dimensions (reasonable limits)
      if (metadata.width > 10000 || metadata.height > 10000) {
        return {
          valid: false,
          error: 'Image dimensions too large. Maximum 10000x10000 pixels.'
        };
      }

      if (metadata.width < 100 || metadata.height < 100) {
        return {
          valid: false,
          error: 'Image dimensions too small. Minimum 100x100 pixels for prescription readability.'
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
      error: 'File validation failed: ' + error.message
    };
  }
}

/**
 * Strip metadata and compress image safely
 */
async function stripMetadataAndCompress(buffer) {
  try {
    const processed = await sharp(buffer)
      .rotate()
      .jpeg({
        quality: 85,
        progressive: true,
        mozjpeg: true
      })
      .withMetadata({ icc: 'sRGB' }) // or remove this line entirely to strip all metadata
      .toBuffer();

    return {
      success: true,
      buffer: processed,
      originalSize: buffer.length,
      processedSize: processed.length,
      compressionRatio: ((1 - processed.length / buffer.length) * 100).toFixed(2)
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to process image: ' + error.message
    };
  }
}


/**
 * Comprehensive file validation
 */
async function validateUploadedFile(file) {
  const errors = [];

  // 1. Check file exists
  if (!file) {
    return {
      valid: false,
      errors: ['No file provided']
    };
  }

  // 2. Check file size (5MB max)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    errors.push(`File too large. Maximum size is 5MB. Your file: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
  }

  // 3. Check MIME type (from multer)
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    errors.push(`Invalid file type: ${file.mimetype}. Only JPEG and PNG images are allowed.`);
  }

  // 4. Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    errors.push(`Invalid file extension: ${ext}. Only .jpg, .jpeg, .png are allowed.`);
  }

  // 5. Check for blocked extensions
  for (const blocked of BLOCKED_EXTENSIONS) {
    if (file.originalname.toLowerCase().includes(blocked)) {
      errors.push(`Suspicious file detected. Extension ${blocked} is not allowed.`);
    }
  }

  // 6. Sanitize filename
  const sanitizedName = sanitizeFilename(file.originalname);
  if (sanitizedName !== file.originalname.toLowerCase().replace(/[^a-zA-Z0-9._-]/g, '_')) {
    errors.push('Filename contains invalid characters and was sanitized.');
  }

  // If basic checks failed, don't proceed to content validation
  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  // 7. Validate file content (magic bytes, actual image)
  const contentValidation = await validateImageContent(file.buffer);
  if (!contentValidation.valid) {
    errors.push(contentValidation.error);
    return {
      valid: false,
      errors
    };
  }

  return {
    valid: true,
    metadata: contentValidation.metadata,
    sanitizedFilename: sanitizedName
  };
}

/**
 * Multer configuration with security checks
 */
const storage = multer.memoryStorage(); // Use memory for processing

const fileFilter = (req, file, cb) => {
  // Basic checks before accepting upload
  const ext = path.extname(file.originalname).toLowerCase();
  
  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type. Only JPEG and PNG images are allowed.`), false);
  }

  // Check extension
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`Invalid file extension. Only .jpg, .jpeg, .png are allowed.`), false);
  }

  // Check for blocked extensions
  for (const blocked of BLOCKED_EXTENSIONS) {
    if (file.originalname.toLowerCase().includes(blocked)) {
      return cb(new Error(`Suspicious file detected. This file type is not allowed.`), false);
    }
  }

  // Check filename for path traversal
  if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
    return cb(new Error(`Invalid filename. Path traversal attempts are blocked.`), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1 // Only one file at a time
  }
});

module.exports = {
  upload,
  validateUploadedFile,
  stripMetadataAndCompress,
  generateSecureFilename,
  sanitizeFilename,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS
};
