/**
 * يتحقق من الدور بعد authenticate. نطاق السجل يبقى مسؤولية scope واستعلامات الخدمات.
 * يحتفظ بالسلوك الحالي الذي يسمح للسوبر أدمن بالوصول إلى مسارات الأدوار الأخرى.
 */
// اكثر من باراميتر
function authorize(...allowedRoles) {
  return (req, res, next) => {
    // نتاكد هل اوثرايزيشن رجعت كائن يوزر ولا لا
    if (!req.user) return res.status(401).json({ message: 'يجب تسجيل الدخول أولًا.' });
    // نخزن رول الكائن
    const roles = req.user.roles || [];
    // لو سوبر ادمن نعطيه اسثتثناء
    if (roles.includes('SUPER_ADMIN') || allowedRoles.some((role) => roles.includes(role))) {
      return next();
    }
    return res.status(403).json({
      code: 'FORBIDDEN', message: 'ليس لديك تصريح للوصول إلى هذا المورد.',
    });
  };
}

module.exports = { authorize };
