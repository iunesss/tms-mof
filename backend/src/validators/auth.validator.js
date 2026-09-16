const { z } = require('zod');
//تعريف مواصفات مدخلات المستخدم
const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'اسم المستخدم يجب أن يحتوي 3 أحرف على الأقل.')
    .max(100, 'اسم المستخدم طويل جدًا.'),

  password: z
    .string()
    .min(1, 'كلمة المرور مطلوبة.')
    .max(255, 'كلمة المرور طويلة جدًا.'),

  rememberMe: z.boolean().optional().default(false),
});

module.exports = { loginSchema };