/**
 * يحول حقول FormData المركبة فقط؛ تستدعيه راوتات الدورات بعد Multer وقبل Zod.
 */
function normalizeCourseBody(req, res, next) {
  try {
    req.body ||= {};
    for (const field of ['allocations', 'directEmployeeIds', 'courseForms', 'removedCourseFormIds']) {
      const value = req.body[field];
      const parsed = value === undefined || value === null || value === ''
        ? [] : typeof value === 'string' ? JSON.parse(value) : value;
      if (!Array.isArray(parsed)) throw new Error(`${field} يجب أن يكون قائمة.`);
      req.body[field] = parsed;
    }
    next();
  } catch (error) {
    res.status(400).json({ message: error.message || 'البيانات المرسلة غير صالحة.' });
  }
}

/** يحتفظ بالحقول الإضافية التي يستعملها controller مثل الاستمارات المحذوفة. */
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
