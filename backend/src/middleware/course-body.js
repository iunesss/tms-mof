/**
 * يحول حقول FormData المركبة فقط؛ تستدعيه راوتات الدورات بعد Multer وقبل Zod.
 */
// لأننا نرسل بيانات الدورات باستخدام FormData لتتمكن الواجهة من رفع الملفات عبر مكتبة Multer. مكتبة Multer عند استقبال المصفوفات (Arrays) أو الكائنات (Objects) عبر FormData تحولها إلى نصوص صافية (Strings) بترميز JSON، أو ترسل القيمة فارغة كـ "" أو undefined. هذه الدالة تقوم بفك تشفير الـ JSON وإعادتها إلى مصفوفات حقيقية (Arrays) قبل أن يقرأها Zod وتفشل عملية الـ Validation

// تحويل معلومات الفورم داتا الى اراي حتى تقبل في قاعدة البيانات
function normalizeCourseBody(req, res, next) {
  try {
    req.body ||= {};
    // توافق الطلبات القديمة: نفك courseData قبل قوائم FormData المستقلة.
    if (req.body.courseData !== undefined) {
      const legacy = typeof req.body.courseData === 'string'
        ? JSON.parse(req.body.courseData) : req.body.courseData;
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        throw new Error('courseData غير صالح.');
      }
      req.body = { ...legacy, ...req.body };
      delete req.body.courseData;
    }
    for (const field of ['allocations', 'directEmployeeIds', 'courseForms', 'removedCourseFormIds']) {
      const value = req.body[field];
      const parsed = value === undefined || value === null || value === ''
        ? [] : typeof value === 'string' ? JSON.parse(value) : value;
      if (!Array.isArray(parsed)) throw new Error(`${field} يجب أن يكون قائمة.`);
      req.body[field] = field === 'allocations'
        ? parsed.map((item) => ({
            ...item,
            departmentId: item.departmentId ?? item.department_id,
            nominationLimit: item.nominationLimit ?? item.seats,
          }))
        : parsed;
    }
    if (req.body.courseType === 'TRAINING' && req.body.status === 'ACTIVE') {
      req.body.status = 'OPEN_FOR_NOMINATION';
    }
    next();
  } catch (error) {
    res.status(400).json({ message: error.message || 'البيانات المرسلة غير صالحة.' });
  }
}

/** يحتفظ بالحقول الإضافية التي يستعملها controller مثل الاستمارات المحذوفة. */
// التاكد ان المعلومات حسب المطلوب وارجاع حفظه في الريمويست بودي
function validateCourseBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        message: result.error.issues[0]?.message || 'بيانات الدورة غير صالحة.',
        errors: result.error.issues,
      });
    }
    req.body = { ...req.body, ...result.data };
    next();
  };
}
module.exports = { normalizeCourseBody, validateCourseBody };
