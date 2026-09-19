const { z } = require('zod');

/** المعرّف من URL نص؛ نحوله مرة واحدة قبل الوصول إلى قاعدة البيانات. */
const notificationIdSchema = z.object({
  notificationId: z.coerce.number().int().positive('معرّف الإشعار غير صالح.'),
});

/** خيارات العرض المشتركة؛ اختلاف أسماء التصنيفات يُعالج في controller حسب الدور. */
const listNotificationsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  category: z.string().trim().toUpperCase().optional().default(''),
  readStatus: z.enum(['READ', 'UNREAD', '']).optional().default(''),
  search: z.string().trim().max(255).optional().default(''),
});

module.exports = { notificationIdSchema, listNotificationsSchema };
