// multer handles the multipart/form-data upload.
// memoryStorage keeps the file as a Buffer in req.file.buffer (nothing written to disk).

const path = require('path');
const multer = require('multer');
const config = require('./config');
const { AppError } = require('./errors');

const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
  fileFilter(req, file, cb) {
    // Check the extension, not the mimetype: Postman/curl often send DOCX as
    // application/octet-stream. textExtractor.js checks the real bytes later.
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new AppError(415, `Unsupported file type "${ext}". Upload a .pdf or .docx`));
    }
    cb(null, true);
  },
});

module.exports = upload;
