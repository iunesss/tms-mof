const { z } = require('zod');

/** اختيار موظف مباشر لمهمة؛ لا يقبل قيمة نصية غير رقمية أو معرّفًا سالبًا. */
const directCandidateSchema = z.object({
  employeeUserId: z.coerce.number().int().positive('الموظف المحدد غير صحيح.'),
});

/** قرار اللجنة؛ الرفض النهائي يحتاج سببًا قابلًا للعرض للموظف. */
const candidateStatusSchema = z.object({
  status: z.enum(['PRELIMINARILY_ACCEPTED', 'CONFIRMED', 'REJECTED']),
  reason: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.status === 'REJECTED' && !value.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'سبب رفض المرشح مطلوب.' });
  }
});

/** قرار مراجعة نسخة المستند أو الاستمارة؛ سبب الرفض إلزامي. */
const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.decision === 'REJECTED' && !value.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'سبب الرفض مطلوب.' });
  }
});

/** أنواع الملفات التي يرسلها مدير الدورة للمرشح، وفق enum قاعدة البيانات. */
const attachmentSchema = z.object({
  attachmentType: z.enum(['VISA', 'TRAVEL_TICKET', 'OFFICIAL_LETTER', 'TRAVEL_DOCUMENT', 'OTHER']),
  note: z.string().trim().max(1000).nullable().optional(),
});

/** مدير القسم يرسل قائمة موظفين فريدة غير فارغة، ويُسمح له بترشيح نفسه. */
const submitNominationsSchema = z.object({
  employeeUserIds: z.array(z.number().int().positive()).min(1).transform((ids) => [...new Set(ids)]),
});

/** قرار الوكيل على قائمة ترشيحات؛ سبب الرفض إلزامي. */
const decideNominationsSchema = z.object({
  nominationIds: z.array(z.number().int().positive()).min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'قائمة الترشيحات تحتوي تكرارًا.'),
  isConfirmed: z.boolean(),
  reason: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, context) => {
  if (!value.isConfirmed && !value.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'سبب رفض الترشيحات مطلوب.' });
  }
});

module.exports = {
  directCandidateSchema, candidateStatusSchema, reviewSchema, attachmentSchema,
  submitNominationsSchema, decideNominationsSchema,
};
