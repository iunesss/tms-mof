const jwt = require('jsonwebtoken');
const pool = require('../config/database');
//التاكد من الهويه قبل السماح بالدخول
async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.tms_token;

    if (!token) {
      return res.status(401).json({
        message: 'يجب تسجيل الدخول أولًا.',
      });
    }
//فك تشفير التوكن
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // نتحقق من قاعدة البيانات في كل طلب مهم:
    // إذا أوقف Super Admin الحساب، ينتهي الوصول فورًا.
    const [rows] = await pool.execute(
      `
        SELECT
          u.id,
          u.username,
          r.code AS role_code
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.id = ?
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
      `,
      [decoded.userId]
    );

    if (!rows.length) {
      return res.status(401).json({
        message: 'الحساب غير نشط أو لم يعد متاحًا.',
      });
    }
//كائن بعد التاكد من وجوده قاعده البيانات 
    req.user = {
      id: rows[0].id,
      username: rows[0].username,
      roles: rows.map((row) => row.role_code).filter(Boolean),
    };

    next();
  } catch (error) {  
    console.error('Authentication failed:', error.name, error.message);

    return res.status(401).json({
      message: 'انتهت الجلسة أو رمز الدخول غير صالح.',
    });
  }
}

module.exports = { authenticate };