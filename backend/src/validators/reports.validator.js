const { z } = require('zod');

/** فلاتر التقارير لا تغير بيانات؛ نحد الطول والمدى قبل بناء الاستعلام. */
// تحويل الحقل الفارغ الى unidentified
const optional = (schema) => z.preprocess((value) => value === '' ? undefined : value, schema.optional());
const page = optional(z.coerce.number().int().min(1));
const limit = optional(z.coerce.number().int().min(1).max(100));
const search = z.string().trim().max(255).optional();
const auditLogsQuerySchema = z.object({
  page, limit, search,
  eventType: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  date: optional(z.iso.date()),
});
const archiveQuerySchema = z.object({
  page, limit, search,
  courseType: z.enum(['TRAINING', 'MISSION', '']).optional(),
  status: z.enum(['COMPLETED', 'ARCHIVED', 'CANCELLED', '']).optional(),
  year: optional(z.coerce.number().int().min(2001).max(2100)),
});

module.exports = { auditLogsQuerySchema, archiveQuerySchema };
