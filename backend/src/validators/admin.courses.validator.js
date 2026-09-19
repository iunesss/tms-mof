const { z } = require('zod');

/** يحول أرقام FormData النصية إلى معرّفات موجبة. */
function positiveInteger(label) {
  return z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) {
        return undefined;
      }

      const numberValue =
        typeof value === 'number' ? value : Number(String(value).trim());

      return Number.isInteger(numberValue) ? numberValue : value;
    },
    z
      .number({
        required_error: `${label} مطلوب.`,
        invalid_type_error: `${label} يجب أن يكون رقمًا صحيحًا.`,
      })
      .int()
      .positive(`${label} يجب أن يكون أكبر من صفر.`)
  );
}

/** يحول الحقل الاختياري الفارغ إلى null قبل حفظه. */
function optionalText(maxLength = 1000) {
  return z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) {
        return null;
      }

      return String(value).trim();
    },
    z.string().max(maxLength).nullable()
  );
}

/** غياب القائمة يعني عدم الاختيار، أما القيمة غير القائمة فخطأ إدخال. */
const idArraySchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return value;

    return value.map((item) => {
      const numberValue = Number(item);
      return Number.isInteger(numberValue) ? numberValue : item;
    });
  },
  z.array(
    z
      .number({
        invalid_type_error: 'معرّف الموظف غير صالح.',
      })
      .int()
      .positive('معرّف الموظف غير صالح.')
  )
);

const allocationSchema = z.object({
  departmentId: positiveInteger('القسم'),
  nominationLimit: positiveInteger('حد الترشيحات'),
  employeeIds: idArraySchema.optional(),
});
const courseFormSchema = z.object({
  id: z
    .preprocess(
      (value) => {
        if (value === '' || value === null || value === undefined) {
          return null;
        }

        const numberValue = Number(value);
        return Number.isInteger(numberValue) ? numberValue : value;
      },
      z.number().int().positive().nullable()
    )
    .optional(),

  title: z
    .string({
      required_error: 'اسم الاستمارة مطلوب.',
    })
    .trim()
    .min(2, 'اسم الاستمارة يجب أن يحتوي على حرفين على الأقل.')
    .max(255, 'اسم الاستمارة طويل جدًا.'),

  isRequired: z.preprocess(
    (value) =>
      value === undefined ||
      value === true ||
      value === 'true' ||
      value === 1 ||
      value === '1',
    z.boolean()
  ),

  dueAt: optionalText(30),

  fileIndex: z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) {
        return null;
      }

      const numberValue = Number(value);
      return Number.isInteger(numberValue) ? numberValue : value;
    },
    z.number().int().nonnegative().nullable()
  ),
});

const removedCourseFormIdsSchema = z.array(
  z.preprocess(
    (value) => {
      const numberValue = Number(value);
      return Number.isInteger(numberValue) ? numberValue : value;
    },
    z.number().int().positive('معرّف الاستمارة المحذوفة غير صالح.')
  )
);
const baseCourseSchema = z.object({
  courseNo: optionalText(100),

  courseType: z.enum(['TRAINING', 'MISSION'], {
    errorMap: () => ({
      message: 'نوع الدورة غير صالح.',
    }),
  }),

  title: z
    .string({
      required_error: 'اسم الدورة مطلوب.',
    })
    .trim()
    .min(3, 'اسم الدورة يجب أن يحتوي على 3 أحرف على الأقل.')
    .max(500),

  description: optionalText(5000),
  provider: optionalText(255),
  location: optionalText(255),
  startDate: optionalText(30),
  endDate: optionalText(30),
  nominationDeadline: optionalText(30),

  totalSeats: positiveInteger('إجمالي المقاعد النهائية'),

  status: z.enum([
    'DRAFT',
    'OPEN_FOR_NOMINATION',
    'ACTIVE',
    'COMPLETED',
    'ARCHIVED',
    'CANCELLED',
  ], {
    errorMap: () => ({
      message: 'حالة الدورة غير صالحة.',
    }),
  }).optional().default('DRAFT'),
  allocations: z
    .array(allocationSchema)
    .min(1, 'أضف قسمًا واحدًا على الأقل.'),

  directEmployeeIds: idArraySchema.optional().default([]),
  courseForms: z.array(courseFormSchema).optional().default([]),

  removedCourseFormIds: removedCourseFormIdsSchema.optional().default([]),
});

const createCourseSchema = baseCourseSchema.superRefine((data, context) => {
  if (!['DRAFT', 'ACTIVE', 'OPEN_FOR_NOMINATION'].includes(data.status)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'يمكن إنشاء الدورة كمسودة أو نشطة فقط.',
    });
  }
  if (data.courseType === 'TRAINING' && !data.nominationDeadline) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nominationDeadline'],
      message: 'آخر موعد للترشيح مطلوب للدورة التدريبية.',
    });
  }

  if (data.courseType === 'MISSION' && data.directEmployeeIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['directEmployeeIds'],
      message: 'اختر موظفًا واحدًا على الأقل للمهمة.',
    });
  }
});

const updateCourseSchema = baseCourseSchema.superRefine((data, context) => {
  if (data.courseType === 'TRAINING' && !data.nominationDeadline) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nominationDeadline'],
      message: 'آخر موعد للترشيح مطلوب للدورة التدريبية.',
    });
  }
});

module.exports = {
  createCourseSchema,
  updateCourseSchema,
};
