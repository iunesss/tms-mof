/** يطبق Schema المدخلات على body أو params أو query قبل استدعاء الـcontroller. */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(400).json({
        message: result.error.issues[0].message,
        errors: result.error.issues,
      });
    }

    // في Express 5 قد تكون req.query قراءة فقط؛ نخزن الناتج المحول باسم مستقل.
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    next();
  };
}

/** يتحقق من وجود الملف بعد Multer وقبل عملية الحفظ في قاعدة البيانات. */
function requireFile(message = 'يرجى اختيار ملف للرفع.') {
  return (req, res, next) => req.file
    ? next() : res.status(400).json({ message });
}

module.exports = { validate, requireFile };
