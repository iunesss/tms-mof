const jwt = require('jsonwebtoken');
const pool = require('../config/database');

/**
 * يستدعى قبل الراوتات الخاصة: يتحقق من التوكن ثم يحمل أدوار الحساب النشط من قاعدة البيانات.
 * لا يعتمد على أدوار التوكن القديمة بعد تغيير الصلاحيات.
 */
async function authenticate(req, res, next) {
  // الحصول على التوكن من الكوكيز
  const token = req.cookies?.tms_token;
  if (!token) return res.status(401).json({ message: 'يجب تسجيل الدخول أولًا.' });
  // التأكد من وجود المفتاح السري
  if (!process.env.JWT_SECRET) return next(new Error('JWT_SECRET is not configured.'));

  let decoded;
  try {
    // فحص التوكن باستخدام المفتاح السري، مع تحديد خوارزمية التشفير
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    if (!decoded || !['string', 'number'].includes(typeof decoded.userId) ||
        !/^[1-9]\d*$/.test(String(decoded.userId))) {
      return res.status(401).json({ message: 'رمز الدخول غير صالح.' });
    }
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError ||
        error instanceof jwt.NotBeforeError) {
      return res.status(401).json({ message: 'انتهت الجلسة أو رمز الدخول غير صالح.' });
    }
    return next(error);
  }

  try {
    // يبحث بقاعده البيانات بنفس يوزر المستخدم المستخرج من التوكن، ويتأكد من أن الحساب نشط وغير محذوف، ثم يحمل أدوار المستخدم.
    const [rows] = await pool.execute(
      `SELECT u.id, u.username, r.code AS role_code
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ? AND u.is_active = TRUE AND u.deleted_at IS NULL`,
      [decoded.userId]
    );
    if (!rows.length) {
      return res.status(401).json({ message: 'الحساب غير نشط أو لم يعد متاحًا.' });
    }
    req.user = {
      id: rows[0].id, username: rows[0].username,
      roles: [...new Set(rows.map((row) => row.role_code).filter(Boolean))],
    };
    return next();
  } catch (error) {
    // انقطاع قاعدة البيانات خطأ خادم، وليس انتهاء جلسة.
    return next(error);
  }
}

module.exports = { authenticate };
