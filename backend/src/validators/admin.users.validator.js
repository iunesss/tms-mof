const { z } = require('zod');

/** الأدوار التي يمكن إنشاؤها من إدارة المستخدمين. */
const roleCodeSchema = z.enum([
  'COURSE_MANAGER',
  'AGENT',
  'DEPARTMENT_MANAGER',
  'EMPLOYEE',
]);

/** بيانات الربط التنظيمي، وتختلف الحقول المطلوبة حسب دور الحساب. */
const assignmentSchema = z.object({
  sectorName: z.string().trim().min(2).max(150).nullable().optional(),
  agentUserId: z.coerce.number().int().positive().nullable().optional(),
  departmentName: z.string().trim().min(2).max(150).nullable().optional(),
  managerUserId: z.coerce.number().int().positive().nullable().optional(),
}).nullable().optional();

const userBaseSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'اسم المستخدم يجب أن يحتوي على 3 أحرف على الأقل.')
    .max(50, 'اسم المستخدم طويل جدًا.')
    .regex(
      /^[\u0600-\u06FFa-zA-Z0-9._-]+$/u,
      'اسم المستخدم يقبل الأحرف العربية أو الإنجليزية والأرقام والنقطة والشرطة فقط.'
    ),

  roleCode: roleCodeSchema,

  fullName: z
    .string()
    .trim()
    .min(3, 'الاسم الكامل مطلوب.')
    .max(150, 'الاسم الكامل طويل جدًا.'),

  employeeNumber: z
    .string()
    .trim()
    .max(50, 'الرقم الوظيفي طويل جدًا.')
    .nullable()
    .optional(),

  assignment: assignmentSchema,
});

/** يمنع إنشاء وكيل أو مدير أو موظف دون ارتباطه التنظيمي اللازم. */
function validateAssignmentByRole(data, ctx) {
  const assignment = data.assignment || {};

  if (data.roleCode === 'AGENT' && !assignment.sectorName?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignment', 'sectorName'],
      message: 'اسم القطاع مطلوب عند إنشاء وكيل قطاع.',
    });
  }

  if (data.roleCode === 'DEPARTMENT_MANAGER') {
    if (!assignment.agentUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignment', 'agentUserId'],
        message: 'يجب اختيار وكيل القطاع لمدير القسم.',
      });
    }

    if (!assignment.departmentName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignment', 'departmentName'],
        message: 'اسم القسم مطلوب لمدير القسم.',
      });
    }
  }

  if (data.roleCode === 'EMPLOYEE' && !assignment.managerUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignment', 'managerUserId'],
      message: 'يجب اختيار مدير القسم للموظف.',
    });
  }
}

const createUserSchema = userBaseSchema
  .extend({
    password: z
      .string()
      .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.')
      .max(100, 'كلمة المرور طويلة جدًا.'),
  })
  .superRefine(validateAssignmentByRole);

const updateUserSchema = userBaseSchema
  .extend({
    newPassword: z
      .string()
      .min(8, 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.')
      .max(100, 'كلمة المرور طويلة جدًا.')
      .nullable()
      .optional(),
  })
  .superRefine(validateAssignmentByRole);

const statusSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().max(500).nullable().optional(),
}).superRefine((data, ctx) => {
  if (!data.isActive && !data.reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'سبب التعطيل مطلوب عند إيقاف المستخدم.',
    });
  }
});

const deleteUserSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'سبب الحذف مطلوب.')
    .max(500, 'سبب الحذف طويل جدًا.'),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  statusSchema,
  deleteUserSchema,
};
