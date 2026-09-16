const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadDirectory = path.join(__dirname, '../../public/uploads/courses');

fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, uploadDirectory);
  },

  filename(req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    const randomName = crypto.randomBytes(16).toString('hex');

    callback(null, `${Date.now()}-${randomName}${extension}`);
  },
});

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);

const fileFilter = (req, file, callback) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    return callback(
      new Error('نوع الملف غير مسموح. استخدم PDF أو Word أو Excel أو صورة JPG/PNG.')
    );
  }

  callback(null, true);
};

const courseUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
}).fields([
  { name: 'agenda', maxCount: 1 },
  { name: 'program', maxCount: 1 },
  { name: 'invitationTemplate', maxCount: 1 },
  { name: 'attachment', maxCount: 1 },

  /*
    ملفات استمارات المرشحين.
    كل ملف هنا يكون نموذجًا أصليًا ينزّله الموظف ويملؤه ثم يرفعه لاحقًا.
  */
  { name: 'courseFormTemplates', maxCount: 10 },
]);
module.exports = {
  courseUpload,
};