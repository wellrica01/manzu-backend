// upload.js
const multer = require('multer')

const storage = multer.memoryStorage() // Use memory instead of disk

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only PDF, JPEG, or PNG files are allowed'))
    }
    cb(null, true)
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
})

module.exports = upload;
