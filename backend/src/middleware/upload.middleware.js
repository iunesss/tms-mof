const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const UPLOAD_ROOT = path.resolve(__dirname, '../../public/uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const documents = {
  'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'], 'image/png': ['.png'],
};
const word = {
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};
const excel = {
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

/**
 * سياسة رفع مشتركة تستعملها الراوتات بعد المصادقة.
 * يحافظ المجلد على توافق storage_key؛ فحص MIME والامتداد ليس فحصًا لمحتوى الملف.
 */
function createUpload(directory, acceptedTypes) {
  return multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        const destination = path.join(UPLOAD_ROOT, directory);
        fs.mkdir(destination, { recursive: true }, (error) => callback(error, destination));
      },
      filename(req, file, callback) {
        callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      },
    }),
    fileFilter(req, file, callback) {
      if (!acceptedTypes[file.mimetype]?.includes(path.extname(file.originalname).toLowerCase())) {
        const error = new Error('نوع الملف أو امتداده غير مسموح لهذا الرفع.');
        error.status = 400;
        return callback(error);
      }
      callback(null, true);
    },
    limits: { fileSize: MAX_FILE_SIZE, files: 14, fields: 100, parts: 114 },
  });
}

const courseUpload = createUpload('courses', { ...documents, ...word, ...excel }).fields([
  { name: 'agenda', maxCount: 1 }, { name: 'program', maxCount: 1 },
  { name: 'invitationTemplate', maxCount: 1 }, { name: 'attachment', maxCount: 1 },
  { name: 'courseFormTemplates', maxCount: 10 },
]);
const profileUpload = createUpload('profiles', documents);
const employeeFormUpload = createUpload('forms', { ...documents, ...word });
const candidateAttachmentUpload = createUpload('candidate-attachments', documents);

module.exports = {
  UPLOAD_ROOT, MAX_FILE_SIZE, courseUpload, profileUpload,
  employeeFormUpload, candidateAttachmentUpload,
};
