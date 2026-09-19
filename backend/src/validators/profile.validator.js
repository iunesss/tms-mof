const { z } = require('zod');

/** حقول الملف التي يملك الموظف والمدير تعديلها؛ الاسم والرقم الوظيفي مستبعدان. */
const nullableText = (max) => z.preprocess(
  (value) => value == null || value === '' ? null : String(value).trim() || null,
  z.string().max(max).nullable().default(null)
);
const updateProfileSchema = z.object({
  email: z.preprocess(
    (value) => value == null || value === '' ? null : String(value).trim() || null,
    z.email('البريد الإلكتروني غير صالح.').max(255).nullable().default(null)
  ),
  phone: nullableText(50),
  jobTitle: nullableText(255),
});

module.exports = { updateProfileSchema };
