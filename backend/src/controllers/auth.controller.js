const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { loginSchema } = require('../validators/auth.validator');

//فنكشن خاص بخفظ كوكيز المستخدم
function getCookieOptions(rememberMe = false) {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/', // مهم: يجعل الجلسة متاحة لكل /api وليس /api/auth فقط
    maxAge: rememberMe
      ? 1000 * 60 * 60 * 24 * 7
      : 1000 * 60 * 60 * 8,
  };
}

async function login(req, res, next) {
  try {
    //جلب معلومات الفاليديشن من الفاليديتور
    const validation = loginSchema.safeParse(req.body);
//فحص بياناات المستخدم هل هي طبق المواصفات
    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0].message,
      });
    }
//ديستركشر
    const { username, password, rememberMe } = validation.data;
//استعلام لقاعده البيانات 
    const [rows] = await pool.execute(
      `
        SELECT
          u.id,
          u.username,
          u.password_hash,
          u.is_active,
          u.deleted_at,
          r.code AS role_code
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.username = ?
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
      `,
      [username]
    );

    // رسالة عامة: لا نكشف هل الاسم موجود أو الحساب موقوف.
    if (!rows.length) {
      return res.status(401).json({
        message: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      });
    }
//تجميع المستخدم في كائن واحد اذا كان عنده اكثر من رول
    const user = {
      id: rows[0].id,
      username: rows[0].username,
      passwordHash: rows[0].password_hash,
      roles: rows
        .map((row) => row.role_code)
        .filter(Boolean),
    };
//مقارنه كلمات المرور
    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      });
    }
//authriztion
    if (!user.roles.length) {
      return res.status(403).json({
        message: 'الحساب لا يملك دورًا صالحًا داخل النظام.',
      });
    }
//ننشا توكن لكل مستخدم
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        roles: user.roles,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: rememberMe ? '7d' : process.env.JWT_EXPIRES_IN || '1d',
      }
    );
//تخزين التوكن في كوكي زالمتصفح
    res.cookie('tms_token', token, getCookieOptions(rememberMe));

    return res.status(200).json({
      message: 'تم تسجيل الدخول بنجاح.',
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles,
      },
    });
  } catch (error) {
    next(error);
  }
}
//طلب معلومات المستخدم الحالي
async function me(req, res) {
  return res.status(200).json({
    user: req.user,
  });
}

function logout(req, res) {
  const isProduction = process.env.NODE_ENV === 'production';

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
  };

  res.clearCookie('tms_token', {
    ...cookieOptions,
    path: '/',
  });

  res.clearCookie('tms_token', {
    ...cookieOptions,
    path: '/api/auth',
  });

  return res.status(200).json({
    message: 'تم تسجيل الخروج بنجاح.',
  });
}
//تصدير الدوال
module.exports = {
  login,
  me,
  logout,
};