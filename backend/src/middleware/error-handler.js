const multer = require('multer');

/** آخر middleware عادي: يجيب فقط عندما لا يوجد راوت مطابق. */
function notFound(req, res) {
  res.status(404).json({ message: 'المسار المطلوب غير موجود.' });
}

/** معالج Express المركزي: يميز أخطاء الطلب والرفع عن أعطال الخادم دون كشف التفاصيل. */
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'حجم الملف أكبر من الحد المسموح: 10 MB.'
        : 'حقول الملفات أو عددها غير صالح.',
    });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'صيغة JSON غير صالحة.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'حجم الطلب أكبر من الحد المسموح.' });
  }
  if (error.status === 400 || error.message?.includes('نوع الملف غير مسموح')) {
    return res.status(400).json({ message: error.message });
  }
  console.error('Server error:', error);
  return res.status(500).json({ message: 'حدث خطأ داخلي في الخادم.' });
}
module.exports = { errorHandler, notFound };
