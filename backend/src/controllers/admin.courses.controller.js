const fs = require('fs');
const crypto = require('crypto');
const { z } = require('zod');
const pool = require('../config/database');
const { writeAuditLog } = require('../utils/audit');
const { createNotification } = require('../utils/notifications');

const {
  createCourseSchema,
  updateCourseSchema,
} = require('../validators/admin.courses.validator');
const candidateStatusSchema = z.object({
  status: z.enum([
    'PRELIMINARILY_ACCEPTED',
    'CONFIRMED',
    'REJECTED',
  ], {
    message: 'حالة المرشح غير صالحة.',
  }),

  reason: z
    .string()
    .trim()
    .max(1000, 'سبب الرفض طويل جدًا.')
    .nullable()
    .optional(),
});

function getActorId(req) {
  return req.user?.id || req.user?.userId || req.user?.user_id;
}

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function parseJson(value) {
  if (!value) return {};

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function buildLocation(country, city) {
  return [country, city].filter(Boolean).join(' - ') || null;
}

function toFileUrl(storageKey) {
  const baseUrl = process.env.API_PUBLIC_URL || 'http://localhost:3000';
  return `${baseUrl}/uploads/${storageKey}`;
}
function normalizeOriginalName(fileName = '') {
  /*
    يعالج أسماء الملفات العربية إذا وصل الاسم بترميز latin1.
  */
  if (/[\u00C0-\u00FF]/.test(fileName)) {
    const decoded = Buffer.from(
      fileName,
      'latin1'
    ).toString('utf8');

    if (!decoded.includes('\uFFFD')) {
      return decoded;
    }
  }

  return fileName;
}
function toUiStatus(dbStatus) {
  if (
    dbStatus === 'OPEN_FOR_NOMINATION' ||
    dbStatus === 'NOMINATION_CLOSED' ||
    dbStatus === 'CANDIDATE_PROCESSING'
  ) {
    return 'ACTIVE';
  }

  return dbStatus;
}

function toDatabaseStatus(courseType, uiStatus) {
  /*
    الحالات النهائية لا يجوز تحويلها إلى دورة مفتوحة
    عند تعديل بياناتها.
  */
  if (
    ['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(uiStatus)
  ) {
    return uiStatus;
  }

  if (uiStatus === 'DRAFT') {
    return 'DRAFT';
  }

  if (courseType === 'TRAINING') {
    return 'OPEN_FOR_NOMINATION';
  }

  return 'CANDIDATE_PROCESSING';
}

async function parseCourseData(req, res) {
  try {
    /*
      يدعم الطريقتين:
      1) Frontend القديم:
         formData.append('courseData', JSON.stringify(courseData))

      2) Frontend الجديد:
         formData.append('courseType', 'TRAINING')
         formData.append('title', '...')
         formData.append('allocations', JSON.stringify(...))
    */
    let rawData = {};

    if (
      typeof req.body.courseData === 'string' &&
      req.body.courseData.trim() !== ''
    ) {
      rawData = JSON.parse(req.body.courseData);
    } else {
      rawData = { ...req.body };
    }

    if (typeof rawData.allocations === 'string') {
      rawData.allocations = JSON.parse(rawData.allocations);
    }

    if (typeof rawData.directEmployeeIds === 'string') {
      rawData.directEmployeeIds = JSON.parse(rawData.directEmployeeIds);
    }
if (typeof rawData.courseForms === 'string') {
  rawData.courseForms = JSON.parse(rawData.courseForms);
}

if (typeof rawData.removedCourseFormIds === 'string') {
  rawData.removedCourseFormIds = JSON.parse(
    rawData.removedCourseFormIds
  );
}

if (!Array.isArray(rawData.courseForms)) {
  rawData.courseForms = [];
}

if (!Array.isArray(rawData.removedCourseFormIds)) {
  rawData.removedCourseFormIds = [];
}
    if (!Array.isArray(rawData.allocations)) {
      rawData.allocations = [];
    }

    if (!Array.isArray(rawData.directEmployeeIds)) {
      rawData.directEmployeeIds = [];
    }

    /*
      توحيد أسماء الحقول:
      HTML القديم يرسل courseNumber / providerName / country / city / seats
      والـValidator الجديد يحتاج courseNo / provider / location / nominationLimit.
    */
    const country = String(rawData.country || '').trim();
    const city = String(rawData.city || '').trim();

    const normalizedData = {

courseForms: rawData.courseForms.map((form) => ({
  id: form.id || null,
  title: String(form.title || '').trim(),
  isRequired: form.isRequired !== false,
  dueAt: form.dueAt || null,
  fileIndex:
    form.fileIndex === null ||
    form.fileIndex === undefined ||
    form.fileIndex === ''
      ? null
      : Number(form.fileIndex),
})),

removedCourseFormIds: rawData.removedCourseFormIds
  .map(Number)
  .filter((id) => Number.isInteger(id) && id > 0),


      courseNo:
        rawData.courseNo ??
        rawData.courseNumber ??
        null,

      courseType:
        rawData.courseType ??
        rawData.course_type ??
        null,

      status:
        rawData.status ??
        rawData.courseStatus ??
        'DRAFT',

      title:
        rawData.title ??
        rawData.courseTitle ??
        null,

      description:
        rawData.description ??
        rawData.courseDescription ??
        null,

      provider:
        rawData.provider ??
        rawData.providerName ??
        null,

      location:
        rawData.location ??
        [country, city].filter(Boolean).join(' - ') ??
        null,

      startDate:
        rawData.startDate ??
        rawData.start_date ??
        null,

      endDate:
        rawData.endDate ??
        rawData.end_date ??
        null,

      nominationDeadline:
        rawData.nominationDeadline ??
        rawData.nomination_deadline ??
        null,

      totalSeats:
        rawData.totalSeats ??
        rawData.total_seats ??
        null,

      allocations: rawData.allocations.map((allocation) => ({
        departmentId:
          allocation.departmentId ??
          allocation.department_id ??
          null,

        nominationLimit:
          allocation.nominationLimit ??
          allocation.nomination_limit ??
          allocation.seats ??
          allocation.allocated_seats ??
          allocation.seats_allocated ??
          null,

        employeeIds: Array.isArray(allocation.employeeIds)
          ? allocation.employeeIds
          : [],
      })),

      directEmployeeIds: rawData.directEmployeeIds,
    };

    /*
      حالة ACTIVE للدورة التدريبية تعني فتحها للترشيح.
    */
    if (
      normalizedData.courseType === 'TRAINING' &&
      normalizedData.status === 'ACTIVE'
    ) {
      normalizedData.status = 'OPEN_FOR_NOMINATION';
    }

    const schema =
      req.method === 'PATCH'
        ? updateCourseSchema
        : createCourseSchema;

    const validation = schema.safeParse(normalizedData);

    if (!validation.success) {
      sendError(
        res,
        400,
        validation.error.issues[0]?.message ||
          'بيانات الدورة غير صحيحة.'
      );

      return null;
    }

    /*
      حواجز أمان: يمنع الوصول إلى INSERT بقيم null.
    */
    if (!validation.data.courseType || !validation.data.title) {
      sendError(res, 400, 'نوع الدورة واسمها مطلوبان.');
      return null;
    }

return {
  ...validation.data,

  /*
    Zod لا يحتفظ بالحقول غير الموجودة في الـSchema تلقائيًا.
    نحافظ على بيانات الاستمارات بعد التحقق من بيانات الدورة.
  */
  courseForms: normalizedData.courseForms || [],
  removedCourseFormIds:
    normalizedData.removedCourseFormIds || [],
};
  } catch (error) {
    console.error('parseCourseData error:', error);

    sendError(
      res,
      400,
      'بيانات الدورة أو الأقسام المرسلة غير صالحة.'
    );

    return null;
  }
}
async function generateCourseNumber(connection) {
  const year = new Date().getFullYear();

  const [[result]] = await connection.query(
    `
      SELECT COUNT(*) + 1 AS next_number
      FROM courses
      WHERE course_no LIKE ?
    `,
    [`CRS-${year}-%`]
  );

  return `CRS-${year}-${String(result.next_number).padStart(4, '0')}`;
}

async function saveUploadedFiles(connection, files, actorUserId, courseId) {
  const fileFields = [
    ['agenda', 'AGENDA'],
    ['program', 'PROGRAM'],
    ['invitationTemplate', 'GENERAL_INVITATION'],
    ['attachment', 'OTHER'],
  ];

  function normalizeOriginalName(fileName) {
    /*
      Multer قد يقرأ الاسم العربي بترميز latin1 مثل:
      Ø§Ù„Ø£Ø¬Ù†Ø¯Ø©.pdf
      نحوله إلى UTF-8 بدون لمس الاسم السليم.
    */
    if (/[\u00C0-\u00FF]/.test(fileName)) {
      const decoded = Buffer.from(fileName, 'latin1').toString('utf8');

      if (!decoded.includes('\uFFFD')) {
        return decoded;
      }
    }

    return fileName;
  }

  for (const [fieldName, attachmentType] of fileFields) {
    const file = files?.[fieldName]?.[0];

    if (!file) {
      continue;
    }

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file.path))
      .digest('hex');

    const storageKey = `courses/${file.filename}`;
    const originalName = normalizeOriginalName(file.originalname);

    const [fileResult] = await connection.query(
      `
        INSERT INTO files (
          storage_key,
          original_name,
          mime_type,
          size_bytes,
          checksum,
          uploaded_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        storageKey,
        originalName,
        file.mimetype,
        file.size,
        checksum,
        actorUserId,
      ]
    );

    await connection.query(
      `
        INSERT INTO course_attachments (
          course_id,
          file_id,
          attachment_type,
          uploaded_by_user_id
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        courseId,
        fileResult.insertId,
        attachmentType,
        actorUserId,
      ]
    );
  }
}
async function syncCourseForms(
  connection,
  files,
  courseForms,
  removedCourseFormIds,
  actorUserId,
  courseId
) {
  const templateFiles = files?.courseFormTemplates || [];

  /*
    Soft Delete للنماذج التي حذفها مدير الدورة من واجهة التعديل.
    لا نحذفها فعليًا حتى لا نخسر تاريخ المرشحين.
  */
  if (removedCourseFormIds?.length) {
    const placeholders = removedCourseFormIds.map(() => '?').join(',');

    await connection.query(
      `
        UPDATE course_forms
        SET deleted_at = NOW()
        WHERE course_id = ?
          AND id IN (${placeholders})
          AND deleted_at IS NULL
      `,
      [courseId, ...removedCourseFormIds]
    );
  }

  for (const form of courseForms || []) {
    /*
      النموذج الموجود سابقًا لا يحتاج ملفًا جديدًا.
      يمكن تعديل عنوانه وإلزاميته وموعده.
    */
    if (form.id) {
      await connection.query(
        `
          UPDATE course_forms
          SET
            title = ?,
            is_required = ?,
            due_at = ?
          WHERE id = ?
            AND course_id = ?
            AND deleted_at IS NULL
        `,
        [
          form.title,
          form.isRequired ? 1 : 0,
          form.dueAt || null,
          form.id,
          courseId,
        ]
      );

      continue;
    }

    /*
      نموذج جديد: يجب أن يملك ملف Template مطابقًا لـ fileIndex.
    */
    const file = templateFiles[form.fileIndex];

    if (!file) {
      throw new Error(
        `يرجى اختيار ملف للاستـمارة: ${form.title || 'بدون اسم'}.`
      );
    }

    if (!form.title) {
      throw new Error('يرجى كتابة اسم كل استمارة مضافة.');
    }

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file.path))
      .digest('hex');

    const rawName = file.originalname;

    const originalName = /[\u00C0-\u00FF]/.test(rawName)
      ? Buffer.from(rawName, 'latin1').toString('utf8')
      : rawName;

    const storageKey = `courses/${file.filename}`;

    const [fileResult] = await connection.query(
      `
        INSERT INTO files (
          storage_key,
          original_name,
          mime_type,
          size_bytes,
          checksum,
          uploaded_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        storageKey,
        originalName,
        file.mimetype,
        file.size,
        checksum,
        actorUserId,
      ]
    );

    const [courseFormResult] = await connection.query(
      `
        INSERT INTO course_forms (
          course_id,
          title,
          template_file_id,
          is_required,
          due_at,
          display_order,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        courseId,
        form.title,
        fileResult.insertId,
        form.isRequired ? 1 : 0,
        form.dueAt || null,
        form.fileIndex || 0,
        actorUserId,
      ]
    );

    /*
      إذا أضيفت استمارة بعد وجود مرشحين،
      ننشئ Submission Pending لكل مرشح حالي.
    */
    await connection.query(
      `
        INSERT INTO candidate_form_submissions (
          candidate_id,
          course_form_id
        )
        SELECT c.id, ?
        FROM candidates c
        WHERE c.course_id = ?
          AND c.status NOT IN (
            'REJECTED',
            'WITHDRAWN',
            'REMOVED',
            'CANCELLED'
          )
      `,
      [courseFormResult.insertId, courseId]
    );
  }
}


async function validateDepartments(connection, allocations) {
  const departmentIds = allocations.map(
    (allocation) => allocation.departmentId
  );

  const [departments] = await connection.query(
    `
      SELECT id, sector_id, name
      FROM departments
      WHERE id IN (?)
        AND deleted_at IS NULL
    `,
    [departmentIds]
  );

  if (departments.length !== departmentIds.length) {
    throw new Error('يوجد قسم غير صالح أو محذوف ضمن توزيع الترشيحات.');
  }

  return departments;
}

/*
  total_seats:
  عدد المقبولين النهائيين للدورة.

  nomination_limit:
  الحد الأعلى لترشيحات كل قسم، ويمكن أن يكون أكبر من total_seats.
*/
async function syncTargetsAndLimits(
  connection,
  courseId,
  allocations,
  actorUserId
) {
  const departments = await validateDepartments(connection, allocations);

  await connection.query(
    'DELETE FROM course_department_allocations WHERE course_id = ?',
    [courseId]
  );

  await connection.query(
    'DELETE FROM course_sector_targets WHERE course_id = ?',
    [courseId]
  );

  const departmentsById = new Map(
    departments.map((department) => [
      Number(department.id),
      department,
    ])
  );

  const sectorIds = new Set();

  for (const allocation of allocations) {
    const department = departmentsById.get(
      Number(allocation.departmentId)
    );

    sectorIds.add(department.sector_id);

    await connection.query(
      `
        INSERT INTO course_department_allocations (
          course_id,
          department_id,
          nomination_limit,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        courseId,
        allocation.departmentId,
        allocation.nominationLimit,
        actorUserId,
        actorUserId,
      ]
    );
  }

  for (const sectorId of sectorIds) {
    await connection.query(
      `
        INSERT INTO course_sector_targets (
          course_id,
          sector_id,
          added_by_user_id
        )
        VALUES (?, ?, ?)
      `,
      [courseId, sectorId, actorUserId]
    );
  }
}

/*
  لا توجد دعوة وكيل.
  الدورة النشطة ترسل دعوة مباشرة لكل مدير قسم تم اختياره.
*/
async function sendDepartmentManagerInvitations(
  connection,
  courseId,
  actorUserId,
  courseTitle
) {
  const [departments] = await connection.query(
    `
      SELECT
        cda.department_id,
        d.sector_id,
        dma.manager_user_id
      FROM course_department_allocations cda
      INNER JOIN departments d
        ON d.id = cda.department_id
      INNER JOIN department_manager_assignments dma
        ON dma.department_id = cda.department_id
        AND dma.end_date IS NULL
      INNER JOIN users u
        ON u.id = dma.manager_user_id
      WHERE cda.course_id = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `,
    [courseId]
  );

  const [[allocationsCount]] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM course_department_allocations
      WHERE course_id = ?
    `,
    [courseId]
  );

  if (departments.length !== allocationsCount.total) {
    throw new Error(
      'لا يمكن تفعيل الدورة: أحد الأقسام المحددة لا يملك مدير قسم فعالًا.'
    );
  }

  for (const department of departments) {
    const [[existingInvitation]] = await connection.query(
      `
        SELECT id
        FROM course_invitations
        WHERE course_id = ?
          AND recipient_user_id = ?
          AND department_id = ?
          AND invitation_type = 'DEPARTMENT_MANAGER_INVITATION'
          AND status IN ('PENDING', 'VIEWED', 'ACCEPTED')
      `,
      [
        courseId,
        department.manager_user_id,
        department.department_id,
      ]
    );

    if (existingInvitation) continue;

    const [invitationResult] = await connection.query(
      `
        INSERT INTO course_invitations (
          course_id,
          sender_user_id,
          recipient_user_id,
          sector_id,
          department_id,
          invitation_type,
          status
        )
        VALUES (?, ?, ?, ?, ?, 'DEPARTMENT_MANAGER_INVITATION', 'PENDING')
      `,
      [
        courseId,
        actorUserId,
        department.manager_user_id,
        department.sector_id,
        department.department_id,
      ]
    );

    await connection.query(
      `
        INSERT INTO invitation_actions (
          invitation_id,
          action,
          actor_user_id,
          note
        )
        VALUES (?, 'SENT', ?, ?)
      `,
      [
        invitationResult.insertId,
        actorUserId,
        'تم إرسال دعوة مباشرة لمدير القسم.',
      ]
    );

    await createNotification(connection, {
      recipientUserId: department.manager_user_id,
      senderUserId: actorUserId,
      notificationType: 'COURSE_DEPARTMENT_MANAGER_INVITATION',
      title: 'دعوة لترشيح موظفي القسم',
      message: `لديك دعوة جديدة لترشيح موظفين من قسمك في الدورة: ${courseTitle}`,
      relatedEntityType: 'COURSE_INVITATION',
      relatedEntityId: invitationResult.insertId,
    });
  }
}

async function getMissionEmployee(connection, employeeUserId) {
  const [[employee]] = await connection.query(
    `
      SELECT DISTINCT
        u.id,
        up.full_name,
        up.employee_number,
        up.email,
        up.phone,
        up.job_title,
        eda.department_id,
        d.name AS department_name,
        s.id AS sector_id,
        s.name AS sector_name
      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'EMPLOYEE'
      INNER JOIN employee_department_assignments eda
        ON eda.employee_user_id = u.id
        AND eda.end_date IS NULL
      INNER JOIN departments d
        ON d.id = eda.department_id
      INNER JOIN sectors s
        ON s.id = d.sector_id
      WHERE u.id = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `,
    [employeeUserId]
  );

  return employee;
}

async function createMissionCandidate(
  connection,
  {
    courseId,
    employeeUserId,
    actorUserId,
    courseTitle,
    shouldNotify,
  }
) {
  const employee = await getMissionEmployee(
    connection,
    employeeUserId
  );

  if (!employee) {
    throw new Error(
      'الموظف غير صالح أو ليس لديه دور موظف وتعيين إداري فعال.'
    );
  }

  const [[existingCandidate]] = await connection.query(
    `
      SELECT id
      FROM candidates
      WHERE course_id = ?
        AND employee_user_id = ?
        AND status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
    `,
    [courseId, employeeUserId]
  );

  if (existingCandidate) {
    throw new Error(
      `الموظف ${employee.full_name} مضاف مسبقًا ضمن مرشحي المهمة.`
    );
  }

  const [[departmentLimit]] = await connection.query(
    `
      SELECT nomination_limit
      FROM course_department_allocations
      WHERE course_id = ?
        AND department_id = ?
      FOR UPDATE
    `,
    [courseId, employee.department_id]
  );

  if (!departmentLimit) {
    throw new Error(
      `قسم الموظف ${employee.department_name} غير مضاف ضمن المهمة.`
    );
  }

  const [[currentCandidates]] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM candidates c
      LEFT JOIN candidate_snapshots cs
        ON cs.candidate_id = c.id
      WHERE c.course_id = ?
        AND CAST(
          JSON_UNQUOTE(
            JSON_EXTRACT(cs.organization_snapshot, '$.department_id')
          ) AS UNSIGNED
        ) = ?
        AND c.status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
    `,
    [courseId, employee.department_id]
  );

  if (currentCandidates.total >= departmentLimit.nomination_limit) {
    throw new Error(
      `وصل قسم ${employee.department_name} إلى حد المرشحين المسموح به.`
    );
  }

  const [candidateResult] = await connection.query(
    `
      INSERT INTO candidates (
        course_id,
        employee_user_id,
        source_nomination_id,
        status,
        selected_by_user_id
      )
      VALUES (?, ?, NULL, 'DOCUMENTS_PENDING', ?)
    `,
    [courseId, employeeUserId, actorUserId]
  );

  const candidateId = candidateResult.insertId;

  await connection.query(
    `
      INSERT INTO candidate_snapshots (
        candidate_id,
        profile_snapshot,
        organization_snapshot
      )
      VALUES (?, ?, ?)
    `,
    [
      candidateId,
      JSON.stringify({
        full_name: employee.full_name,
        employee_number: employee.employee_number,
        email: employee.email,
        phone: employee.phone,
        job_title: employee.job_title,
      }),
      JSON.stringify({
        department_id: employee.department_id,
        department_name: employee.department_name,
        sector_id: employee.sector_id,
        sector_name: employee.sector_name,
      }),
    ]
  );

  await connection.query(
    `
      INSERT INTO candidate_status_history (
        candidate_id,
        from_status,
        to_status,
        reason,
        changed_by_user_id
      )
      VALUES (?, NULL, 'DOCUMENTS_PENDING', ?, ?)
    `,
    [
      candidateId,
      'تم اختيار الموظف مباشرة للمهمة.',
      actorUserId,
    ]
  );

  await connection.query(
    `
      INSERT INTO candidate_documents (
        candidate_id,
        document_requirement_id
      )
      SELECT ?, id
      FROM document_requirements
      WHERE course_id = ?
        AND deleted_at IS NULL
    `,
    [candidateId, courseId]
  );

  await connection.query(
    `
      INSERT INTO candidate_form_submissions (
        candidate_id,
        course_form_id
      )
      SELECT ?, id
      FROM course_forms
      WHERE course_id = ?
        AND deleted_at IS NULL
    `,
    [candidateId, courseId]
  );

  if (shouldNotify) {
    await createNotification(connection, {
      recipientUserId: employeeUserId,
      senderUserId: actorUserId,
      notificationType: 'MISSION_CANDIDATE_SELECTED',
      title: 'تم اختيارك لمهمة',
      message: `تم اختيارك للمهمة: ${courseTitle}. يرجى استكمال المستندات والنماذج المطلوبة.`,
      relatedEntityType: 'CANDIDATE',
      relatedEntityId: candidateId,
    });
  }

  return candidateId;
}

async function notifyMissionCandidates(
  connection,
  courseId,
  actorUserId,
  courseTitle
) {
  const [candidates] = await connection.query(
    `
      SELECT id, employee_user_id
      FROM candidates
      WHERE course_id = ?
        AND status = 'DOCUMENTS_PENDING'
    `,
    [courseId]
  );

  for (const candidate of candidates) {
    await createNotification(connection, {
      recipientUserId: candidate.employee_user_id,
      senderUserId: actorUserId,
      notificationType: 'MISSION_CANDIDATE_SELECTED',
      title: 'تم اختيارك لمهمة',
      message: `تم اختيارك للمهمة: ${courseTitle}. يرجى استكمال المستندات والنماذج المطلوبة.`,
      relatedEntityType: 'CANDIDATE',
      relatedEntityId: candidate.id,
    });
  }
}

async function listCourses(req, res) {
  try {
    const { search = '', type = '', status = '' } = req.query;

    const conditions = ['c.deleted_at IS NULL'];
    const values = [];

    if (search) {
      conditions.push('(c.title LIKE ? OR c.course_no LIKE ?)');
      values.push(`%${search}%`, `%${search}%`);
    }

    if (type) {
      conditions.push('c.course_type = ?');
      values.push(type);
    }

    if (status) {
      if (status === 'ACTIVE') {
        conditions.push(`
          c.status IN (
            'OPEN_FOR_NOMINATION',
            'NOMINATION_CLOSED',
            'CANDIDATE_PROCESSING',
            'ACTIVE'
          )
        `);
      } else {
        conditions.push('c.status = ?');
        values.push(status);
      }
    }

    const [courses] = await pool.query(
      `
        SELECT
          c.id,
          c.course_no,
          c.course_type,
          c.title,
          c.description,
          c.start_date,
          c.end_date,
          c.total_seats,
          c.status AS db_status,
          COUNT(candidate.id) AS candidates_count
        FROM courses c
        LEFT JOIN candidates candidate
          ON candidate.course_id = c.id
          AND candidate.status NOT IN (
            'REJECTED',
            'WITHDRAWN',
            'REMOVED',
            'CANCELLED'
          )
        WHERE ${conditions.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `,
      values
    );

    return res.json({
      total: courses.length,
      courses: courses.map((course) => ({
        ...course,
        status: toUiStatus(course.db_status),
      })),
    });
  } catch (error) {
    console.error('List courses error:', error);
    return sendError(res, 500, 'تعذر تحميل الدورات.');
  }
}

async function getOrganizationOptions(req, res) {
  try {
    const [departments] = await pool.query(
      `
        SELECT
          d.id,
          d.name,
          d.code,
          s.id AS sector_id,
          s.name AS sector_name
        FROM departments d
        INNER JOIN sectors s
          ON s.id = d.sector_id
        WHERE d.deleted_at IS NULL
          AND s.deleted_at IS NULL
        ORDER BY s.name, d.name
      `
    );

    return res.json({ departments });
  } catch (error) {
    console.error('Course organization options error:', error);
    return sendError(res, 500, 'تعذر تحميل الأقسام.');
  }
}
async function getEligibleEmployees(req, res) {
  try {
    const departmentId = Number(req.query.departmentId);

    if (!Number.isInteger(departmentId) || departmentId <= 0) {
      return res.status(400).json({
        message: 'معرّف القسم غير صالح.',
      });
    }

    const [employees] = await pool.execute(
      `
        SELECT DISTINCT
          u.id,
          u.username,
          up.full_name,
          up.employee_number
        FROM employee_department_assignments eda
        INNER JOIN users u
          ON u.id = eda.employee_user_id
        INNER JOIN user_profiles up
          ON up.user_id = u.id
        INNER JOIN user_roles ur
          ON ur.user_id = u.id
        INNER JOIN roles r
          ON r.id = ur.role_id
        WHERE eda.department_id = ?
          AND eda.end_date IS NULL
          AND u.is_active = 1
          AND u.deleted_at IS NULL
          AND r.code = 'EMPLOYEE'
        ORDER BY up.full_name ASC
      `,
      [departmentId]
    );

    return res.status(200).json({
      employees,
    });
  } catch (error) {
    console.error('Eligible employees error:', error);

    return res.status(500).json({
      message: 'تعذر تحميل موظفي القسم.',
    });
  }
}

async function createCourse(req, res) {
  const actorUserId = getActorId(req);

  if (!actorUserId) {
    return sendError(res, 401, 'انتهت الجلسة.');
  }

  /*
    مهم جدًا:
    parseCourseData دالة async، لذلك يلزم await.
    ونعطيها req و res، وليس كلمة create.
  */
const courseData = await parseCourseData(req, res);
  if (!courseData) {
    return;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const courseNumber =
      courseData.courseNo ||
      courseData.courseNumber ||
      (await generateCourseNumber(connection));

    const dbStatus = toDatabaseStatus(
      courseData.courseType,
      courseData.status
    );

    const [courseResult] = await connection.query(
      `
        INSERT INTO courses (
          course_no,
          course_type,
          title,
          description,
          provider,
          location,
          start_date,
          end_date,
          nomination_deadline,
          total_seats,
          status,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        courseNumber,
        courseData.courseType,
        courseData.title,
        courseData.description || null,
        courseData.provider || courseData.providerName || null,
        courseData.location || buildLocation(courseData.country, courseData.city),
        courseData.startDate || null,
        courseData.endDate || null,
        courseData.courseType === 'TRAINING'
          ? courseData.nominationDeadline || null
          : null,
        courseData.totalSeats,
        dbStatus,
        actorUserId,
      ]
    );

    const courseId = courseResult.insertId;

    await connection.query(
      `
        INSERT INTO course_status_history (
          course_id,
          from_status,
          to_status,
          reason,
          changed_by_user_id
        )
        VALUES (?, NULL, ?, ?, ?)
      `,
      [
        courseId,
        dbStatus,
        'إنشاء الدورة أو المهمة.',
        actorUserId,
      ]
    );

    await syncTargetsAndLimits(
      connection,
      courseId,
      courseData.allocations,
      actorUserId
    );

    await saveUploadedFiles(
      connection,
      req.files,
      actorUserId,
      courseId
    );

await syncCourseForms(
  connection,
  req.files,
  courseData.courseForms,
  [],
  actorUserId,
  courseId
);

    if (courseData.courseType === 'MISSION') {
      for (const employeeUserId of courseData.directEmployeeIds || []) {
        await createMissionCandidate(connection, {
          courseId,
          employeeUserId,
          actorUserId,
          courseTitle: courseData.title,
          shouldNotify: dbStatus !== 'DRAFT',
        });
      }
    }

    if (
      courseData.courseType === 'TRAINING' &&
      dbStatus === 'OPEN_FOR_NOMINATION'
    ) {
      await sendDepartmentManagerInvitations(
        connection,
        courseId,
        actorUserId,
        courseData.title
      );
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'COURSE_CREATED',
      entityType: 'COURSE',
      entityId: courseId,
      afterData: {
        course_no: courseNumber,
        course_type: courseData.courseType,
        status: dbStatus,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message: 'تم إنشاء الدورة بنجاح.',
      course: {
        id: courseId,
        courseNo: courseNumber,
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error('Create course error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر إنشاء الدورة.'
    );
  } finally {
    connection.release();
  }
}

async function getCourse(req, res) {
  const { courseId } = req.params;

  try {
    const [[course]] = await pool.query(
      `
        SELECT c.*, c.status AS db_status
        FROM courses c
        WHERE c.id = ?
          AND c.deleted_at IS NULL
      `,
      [courseId]
    );

    if (!course) {
      return sendError(res, 404, 'الدورة غير موجودة.');
    }

    const [allocations] = await pool.query(
      `
        SELECT
          cda.department_id,
          cda.nomination_limit,
          d.name AS department_name,
          s.name AS sector_name,
          COUNT(n.id) AS nominations_count
        FROM course_department_allocations cda
        INNER JOIN departments d
          ON d.id = cda.department_id
        INNER JOIN sectors s
          ON s.id = d.sector_id
        LEFT JOIN nominations n
          ON n.course_id = cda.course_id
          AND n.department_id = cda.department_id
          AND n.status NOT IN ('AGENT_REJECTED', 'WITHDRAWN')
        WHERE cda.course_id = ?
        GROUP BY
          cda.department_id,
          cda.nomination_limit,
          d.name,
          s.name
        ORDER BY s.name, d.name
      `,
      [courseId]
    );

    const [attachments] = await pool.query(
      `
        SELECT
          ca.id,
          ca.attachment_type,
          f.original_name,
          f.storage_key
        FROM course_attachments ca
        INNER JOIN files f
          ON f.id = ca.file_id
        WHERE ca.course_id = ?
          AND ca.deleted_at IS NULL
          AND f.deleted_at IS NULL
        ORDER BY ca.created_at DESC
      `,
      [courseId]
    );
const [courseForms] = await pool.query(
  `
    SELECT
      cf.id,
      cf.title,
      cf.is_required,
      cf.due_at,
      cf.display_order,
      f.original_name,
      f.storage_key
    FROM course_forms cf
    INNER JOIN files f
      ON f.id = cf.template_file_id
    WHERE cf.course_id = ?
      AND cf.deleted_at IS NULL
      AND f.deleted_at IS NULL
    ORDER BY cf.display_order, cf.created_at
  `,
  [courseId]
);
    return res.json({
      course: {
        ...course,
        status: toUiStatus(course.db_status),
        allocations: allocations.map((allocation) => ({
          ...allocation,
          remaining_nominations:
            allocation.nomination_limit - allocation.nominations_count,
        })),
        attachments: attachments.map((attachment) => ({
          ...attachment,
          file_url: toFileUrl(attachment.storage_key),
        })),
        forms: courseForms.map((form) => ({
          ...form,
          file_url: toFileUrl(form.storage_key),
        })),
      },
    });
  } catch (error) {
    console.error('Get course error:', error);
    return sendError(res, 500, 'تعذر تحميل تفاصيل الدورة.');
  }
}

async function updateCourse(req, res) {
  const actorUserId = getActorId(req);
  const { courseId } = req.params;

  if (!actorUserId) {
    return sendError(res, 401, 'انتهت الجلسة.');
  }

  const courseData = await parseCourseData(req, res);

  if (!courseData) {
    return;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[existingCourse]] = await connection.query(
      `
        SELECT *
        FROM courses
        WHERE id = ?
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [courseId]
    );

    if (!existingCourse) {
      throw new Error('الدورة غير موجودة.');
    }

    const [[candidateCount]] = await connection.query(
      `
        SELECT COUNT(*) AS total
        FROM candidates
        WHERE course_id = ?
      `,
      [courseId]
    );

    if (
      candidateCount.total > 0 &&
      existingCourse.course_type !== courseData.courseType
    ) {
      throw new Error(
        'لا يمكن تغيير نوع الدورة بعد إضافة مرشحين إليها.'
      );
    }

    for (const allocation of courseData.allocations) {
      const [[nominationsCount]] = await connection.query(
        `
          SELECT COUNT(*) AS total
          FROM nominations
          WHERE course_id = ?
            AND department_id = ?
            AND status NOT IN ('AGENT_REJECTED', 'WITHDRAWN')
        `,
        [courseId, allocation.departmentId]
      );

      if (nominationsCount.total > allocation.nominationLimit) {
        throw new Error(
          'لا يمكن تخفيض حد ترشيحات قسم إلى أقل من ترشيحاته الحالية.'
        );
      }
    }

    const dbStatus = toDatabaseStatus(
      courseData.courseType,
      courseData.status
    );

    await connection.query(
      `
        UPDATE courses
        SET
          course_no = ?,
          course_type = ?,
          title = ?,
          description = ?,
          provider = ?,
          location = ?,
          start_date = ?,
          end_date = ?,
          nomination_deadline = ?,
          total_seats = ?,
          status = ?
        WHERE id = ?
      `,
      [
        courseData.courseNo ||
          courseData.courseNumber ||
          existingCourse.course_no,

        courseData.courseType,
        courseData.title,
        courseData.description || null,

        /*
          هذه هي النقطة التي أصلحت الجهة والمكان:
          الواجهة الجديدة ترسل provider و location.
        */
        courseData.provider ||
          courseData.providerName ||
          null,

        courseData.location ||
          buildLocation(courseData.country, courseData.city),

        courseData.startDate || null,
        courseData.endDate || null,

        courseData.courseType === 'TRAINING'
          ? courseData.nominationDeadline || null
          : null,

        courseData.totalSeats,
        dbStatus,
        courseId,
      ]
    );

    await syncTargetsAndLimits(
      connection,
      courseId,
      courseData.allocations,
      actorUserId
    );

    await saveUploadedFiles(
      connection,
      req.files,
      actorUserId,
      courseId
    );

await syncCourseForms(
  connection,
  req.files,
  courseData.courseForms,
  courseData.removedCourseFormIds,
  actorUserId,
  Number(courseId)
);
    /*
      للمهمة فقط:
      الموظفون الذين اختيروا في صفحة التعديل يضافون كمرشحين جدد.
    */
    if (
      courseData.courseType === 'MISSION' &&
      Array.isArray(courseData.directEmployeeIds)
    ) {
      for (const employeeUserId of courseData.directEmployeeIds) {
        await createMissionCandidate(connection, {
          courseId: Number(courseId),
          employeeUserId,
          actorUserId,
          courseTitle: courseData.title,
          shouldNotify: dbStatus !== 'DRAFT',
        });
      }
    }

    /*
      دورة تدريبية:
      عند الانتقال من مسودة إلى مفتوحة للترشيح،
      ترسل الدعوات مباشرة إلى مديري الأقسام.
    */
    if (
      existingCourse.status !== 'OPEN_FOR_NOMINATION' &&
      dbStatus === 'OPEN_FOR_NOMINATION'
    ) {
      await sendDepartmentManagerInvitations(
        connection,
        Number(courseId),
        actorUserId,
        courseData.title
      );
    }

    /*
      مهمة:
      عند تفعيل المهمة بعد أن كانت مسودة، نرسل إشعارات
      للموظفين الذين تم اختيارهم مسبقًا.
    */
    if (
      existingCourse.status === 'DRAFT' &&
      dbStatus === 'CANDIDATE_PROCESSING' &&
      courseData.courseType === 'MISSION'
    ) {
      await notifyMissionCandidates(
        connection,
        Number(courseId),
        actorUserId,
        courseData.title
      );
    }

    if (existingCourse.status !== dbStatus) {
      await connection.query(
        `
          INSERT INTO course_status_history (
            course_id,
            from_status,
            to_status,
            reason,
            changed_by_user_id
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          courseId,
          existingCourse.status,
          dbStatus,
          'تعديل حالة الدورة.',
          actorUserId,
        ]
      );
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'COURSE_UPDATED',
      entityType: 'COURSE',
      entityId: Number(courseId),
      beforeData: {
        title: existingCourse.title,
        provider: existingCourse.provider,
        location: existingCourse.location,
        status: existingCourse.status,
      },
      afterData: {
        title: courseData.title,
        provider: courseData.provider || null,
        location: courseData.location || null,
        status: dbStatus,
      },
    });

    await connection.commit();

    return res.json({
      message: 'تم حفظ تعديلات الدورة بنجاح.',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Update course error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر تعديل الدورة.'
    );
  } finally {
    connection.release();
  }
}

async function listCourseCandidates(req, res) {
  const { courseId } = req.params;

  try {
    const [candidates] = await pool.query(
      `
        SELECT
          c.id,
          c.status,
          c.selected_at,
          up.full_name,
          up.employee_number,
          COALESCE(
            d.name,
            JSON_UNQUOTE(
              JSON_EXTRACT(cs.organization_snapshot, '$.department_name')
            )
          ) AS department_name,
          COALESCE(
            s.name,
            JSON_UNQUOTE(
              JSON_EXTRACT(cs.organization_snapshot, '$.sector_name')
            )
          ) AS sector_name
        FROM candidates c
        INNER JOIN user_profiles up
          ON up.user_id = c.employee_user_id
        LEFT JOIN nominations n
          ON n.id = c.source_nomination_id
        LEFT JOIN departments d
          ON d.id = n.department_id
        LEFT JOIN sectors s
          ON s.id = d.sector_id
        LEFT JOIN candidate_snapshots cs
          ON cs.candidate_id = c.id
        WHERE c.course_id = ?
        ORDER BY c.selected_at DESC
      `,
      [courseId]
    );
const [approvedNominations] = await pool.query(
  `
    SELECT
      n.id,
      n.created_at,
      up.full_name,
      up.employee_number,
      d.name AS department_name,
      s.name AS sector_name
    FROM nominations n
    INNER JOIN user_profiles up
      ON up.user_id = n.nominee_user_id
    INNER JOIN departments d
      ON d.id = n.department_id
    INNER JOIN sectors s
      ON s.id = d.sector_id
    LEFT JOIN candidates candidate
      ON candidate.source_nomination_id = n.id
    WHERE n.course_id = ?
      AND n.status = 'AGENT_CONFIRMED'
      AND candidate.id IS NULL
    ORDER BY s.name, d.name, n.created_at
  `,
  [courseId]
);
return res.json({ candidates, approvedNominations });  } catch (error) {
    console.error('List course candidates error:', error);
    return sendError(res, 500, 'تعذر تحميل المرشحين.');
  }
}

async function addDirectCandidate(req, res) {
  const actorUserId = getActorId(req);
  const { courseId } = req.params;

  const validation = directCandidateSchema.safeParse(req.body);

  if (!validation.success) {
    return sendError(res, 400, 'الموظف المحدد غير صحيح.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[course]] = await connection.query(
      `
        SELECT *
        FROM courses
        WHERE id = ?
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [courseId]
    );

    if (!course || course.course_type !== 'MISSION') {
      throw new Error('الإضافة المباشرة للموظفين متاحة للمهمة فقط.');
    }

    const candidateId = await createMissionCandidate(connection, {
      courseId: Number(courseId),
      employeeUserId: validation.data.employeeUserId,
      actorUserId,
      courseTitle: course.title,
      shouldNotify: course.status !== 'DRAFT',
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'MISSION_CANDIDATE_ADDED',
      entityType: 'CANDIDATE',
      entityId: candidateId,
    });

    await connection.commit();

    return res.status(201).json({
      message: 'تمت إضافة الموظف كمرشح للمهمة.',
      candidate: { id: candidateId },
    });
  } catch (error) {
    await connection.rollback();
    console.error('Direct candidate error:', error);

    return sendError(res, 400, error.message || 'تعذر إضافة المرشح.');
  } finally {
    connection.release();
  }
}

async function getCandidate(req, res) {
  const { courseId, candidateId } = req.params;

  try {
    const [[candidate]] = await pool.query(
      `
        SELECT
          c.*,
          co.title AS course_title,
          up.full_name,
          up.employee_number,
          cs.profile_snapshot,
          cs.organization_snapshot
        FROM candidates c
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN user_profiles up
          ON up.user_id = c.employee_user_id
        LEFT JOIN candidate_snapshots cs
          ON cs.candidate_id = c.id
        WHERE c.id = ?
          AND c.course_id = ?
      `,
      [candidateId, courseId]
    );

    if (!candidate) {
      return sendError(res, 404, 'المرشح غير موجود ضمن هذه الدورة.');
    }

    const [
      formsResult,
      profileDocumentsResult,
      attachmentsResult,
      statusHistoryResult,
    ] = await Promise.all([
      pool.query(
        `
          SELECT
            cfs.id,
            cf.title,
            cf.is_required,
            cfs.status,
            cfs.current_version_no,
            cfs.last_submitted_at,
            cfs.reviewed_at,
            cfs.rejection_reason,

            f.original_name,
            f.storage_key

          FROM candidate_form_submissions cfs
          INNER JOIN course_forms cf
            ON cf.id = cfs.course_form_id

          LEFT JOIN form_submission_versions fsv
            ON fsv.candidate_form_submission_id = cfs.id
            AND fsv.version_no = cfs.current_version_no

          LEFT JOIN files f
            ON f.id = fsv.file_id

          WHERE cfs.candidate_id = ?

          ORDER BY
            cf.display_order ASC,
            cf.title ASC
        `,
        [candidateId]
      ),

      pool.query(
        `
          SELECT
            pd.id,
            pd.document_type,
            pd.label,
            pd.status,

            latest_review.rejection_reason,
            latest_review.reviewed_at,

            f.original_name,
            f.storage_key

          FROM profile_documents pd

          LEFT JOIN profile_document_versions pdv
            ON pdv.profile_document_id = pd.id
            AND pdv.version_no = (
              SELECT MAX(version_no)
              FROM profile_document_versions
              WHERE profile_document_id = pd.id
            )

          LEFT JOIN files f
            ON f.id = pdv.file_id

          LEFT JOIN profile_document_reviews latest_review
            ON latest_review.id = (
              SELECT MAX(review2.id)
              FROM profile_document_reviews review2
              WHERE review2.profile_document_version_id = pdv.id
            )

          WHERE pd.user_profile_id = ?
            AND pd.deleted_at IS NULL

          ORDER BY pd.created_at DESC
        `,
        [candidate.employee_user_id]
      ),

      pool.query(
        `
          SELECT
            ca.id,
            ca.attachment_type,
            ca.note,
            ca.created_at,

            f.original_name,
            f.storage_key

          FROM candidate_attachments ca
          INNER JOIN files f
            ON f.id = ca.file_id

          WHERE ca.candidate_id = ?
            AND ca.deleted_at IS NULL

          ORDER BY ca.created_at DESC
        `,
        [candidateId]
      ),

      pool.query(
        `
          SELECT
            from_status,
            to_status,
            reason,
            changed_at
          FROM candidate_status_history
          WHERE candidate_id = ?
          ORDER BY changed_at DESC
        `,
        [candidateId]
      ),
    ]);

    const [forms] = formsResult;
    const [profileDocuments] = profileDocumentsResult;
    const [attachments] = attachmentsResult;
    const [statusHistory] = statusHistoryResult;

    return res.json({
      candidate: {
        ...candidate,

        snapshot: {
          ...parseJson(candidate.profile_snapshot),
          ...parseJson(candidate.organization_snapshot),
        },

        forms: forms.map((form) => ({
          ...form,
          file_url: form.storage_key
            ? toFileUrl(form.storage_key)
            : null,
        })),

        profile_documents: profileDocuments
          .filter((document) => document.storage_key)
          .map((document) => ({
            ...document,
            file_url: toFileUrl(document.storage_key),
          })),

        attachments: attachments.map((attachment) => ({
          ...attachment,
          file_url: toFileUrl(attachment.storage_key),
        })),

        status_history: statusHistory,
      },
    });
  } catch (error) {
    console.error('Get candidate error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل تفاصيل المرشح.'
    );
  }
}

async function ensureCandidateReadyForPreliminaryAcceptance(
  connection,
  candidateId
) {
  const [[candidate]] = await connection.query(
    `
      SELECT
        id,
        employee_user_id,
        course_id
      FROM candidates
      WHERE id = ?
    `,
    [candidateId]
  );

  if (!candidate) {
    throw new Error('المرشح غير موجود.');
  }

  /*
    1. التحقق من كل الاستمارات الإلزامية.
  */
  const [incompleteForms] = await connection.query(
    `
      SELECT
        cf.title,
        cfs.status
      FROM course_forms cf
      LEFT JOIN candidate_form_submissions cfs
        ON cfs.course_form_id = cf.id
        AND cfs.candidate_id = ?

      WHERE cf.course_id = ?
        AND cf.deleted_at IS NULL
        AND cf.is_required = 1
        AND (
          cfs.id IS NULL
          OR cfs.status <> 'APPROVED'
        )

      ORDER BY cf.display_order, cf.title
    `,
    [
      candidateId,
      candidate.course_id,
    ]
  );

  if (incompleteForms.length) {
    const formNames = incompleteForms
      .map((form) => form.title)
      .join('، ');

    throw new Error(
      `لا يمكن القبول المبدئي قبل اعتماد جميع الاستمارات الإلزامية: ${formNames}.`
    );
  }

  /*
    2. التحقق من جواز السفر الشخصي.
    يجب أن يكون موجودًا وله نسخة مرفوعة وحالته APPROVED.
  */
  const [[passport]] = await connection.query(
    `
      SELECT
        pd.id
      FROM profile_documents pd
      INNER JOIN profile_document_versions pdv
        ON pdv.profile_document_id = pd.id
        AND pdv.version_no = (
          SELECT MAX(version_no)
          FROM profile_document_versions
          WHERE profile_document_id = pd.id
        )

      WHERE pd.user_profile_id = ?
        AND pd.document_type = 'PASSPORT'
        AND pd.deleted_at IS NULL
        AND pd.status = 'APPROVED'

      LIMIT 1
    `,
    [candidate.employee_user_id]
  );

  if (!passport) {
    throw new Error(
      'لا يمكن القبول المبدئي قبل اعتماد جواز سفر المرشح.'
    );
  }
}

async function updateCandidateStatus(req, res) {
  const actorUserId = getActorId(req);
  const { courseId, candidateId } = req.params;

  const validation = candidateStatusSchema.safeParse(req.body);

  if (!validation.success) {
    return sendError(
      res,
      400,
      validation.error.issues[0]?.message ||
        'بيانات الحالة غير صحيحة.'
    );
  }

  const { status, reason } = validation.data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[candidate]] = await connection.query(
      `
        SELECT
          c.*,
          co.title AS course_title,
          co.total_seats
        FROM candidates c
        INNER JOIN courses co
          ON co.id = c.course_id
        WHERE c.id = ?
          AND c.course_id = ?
        FOR UPDATE
      `,
      [candidateId, courseId]
    );

    if (!candidate) {
      throw new Error('المرشح غير موجود.');
    }

    /*
      القبول المبدئي مشروط باعتماد:
      - كل الاستمارات الإلزامية
      - جواز السفر الشخصي
    */
    if (status === 'PRELIMINARILY_ACCEPTED') {
      await ensureCandidateReadyForPreliminaryAcceptance(
        connection,
        candidateId
      );
    }

    /*
      فقط التأكيد النهائي وما بعده يستهلك مقعدًا.
    */
    if (status === 'CONFIRMED') {
      const [[confirmedCount]] = await connection.query(
        `
          SELECT COUNT(*) AS total
          FROM candidates
          WHERE course_id = ?
            AND id <> ?
            AND status IN (
              'CONFIRMED',
              'PARTICIPATING',
              'COMPLETED'
            )
        `,
        [courseId, candidateId]
      );

      if (Number(confirmedCount.total) >= Number(candidate.total_seats)) {
        throw new Error(
          'لا يمكن تأكيد المرشح؛ اكتمل إجمالي المقاعد النهائية للدورة.'
        );
      }
    }

    const confirmedAt =
      status === 'CONFIRMED'
        ? new Date()
        : candidate.confirmed_at;

    await connection.query(
      `
        UPDATE candidates
        SET
          status = ?,
          confirmed_at = ?,
          removal_reason = ?
        WHERE id = ?
      `,
      [
        status,
        confirmedAt,
        status === 'REJECTED'
          ? reason
          : candidate.removal_reason,
        candidateId,
      ]
    );

    await connection.query(
      `
        INSERT INTO candidate_status_history (
          candidate_id,
          from_status,
          to_status,
          reason,
          changed_by_user_id
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        candidateId,
        candidate.status,
        status,
        reason || null,
        actorUserId,
      ]
    );

    const notifications = {
      PRELIMINARILY_ACCEPTED: {
        type: 'CANDIDATE_PRELIMINARILY_ACCEPTED',
        title: 'تم قبولك مبدئيًا',
        message: `تم قبولك مبدئيًا في الدورة: ${candidate.course_title}.`,
      },

      CONFIRMED: {
        type: 'CANDIDATE_CONFIRMED',
        title: 'تم تأكيد قبولك',
        message: `تم تأكيد قبولك في الدورة: ${candidate.course_title}.`,
      },

      REJECTED: {
        type: 'CANDIDATE_FINAL_REJECTED',
        title: 'نتيجة طلب الترشح',
        message: `تم رفض ترشحك نهائيًا للدورة: ${candidate.course_title}. السبب: ${reason}`,
      },
    };

    if (notifications[status]) {
      const notification = notifications[status];

      await createNotification(connection, {
        recipientUserId: candidate.employee_user_id,
        senderUserId: actorUserId,
        notificationType: notification.type,
        title: notification.title,
        message: notification.message,
        relatedEntityType: 'CANDIDATE',
        relatedEntityId: candidateId,
      });
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'CANDIDATE_STATUS_CHANGED',
      entityType: 'CANDIDATE',
      entityId: Number(candidateId),
      beforeData: {
        status: candidate.status,
      },
      afterData: {
        status,
        reason,
      },
    });

    await connection.commit();

    return res.json({
      message: 'تم تحديث حالة المرشح بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    console.error('Candidate status error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر تحديث حالة المرشح.'
    );
  } finally {
    connection.release();
  }
}

async function reviewCandidateDocument(req, res) {
  const actorUserId = getActorId(req);
  const { courseId, candidateId, documentId } = req.params;

  const validation = documentReviewSchema.safeParse(req.body);

  if (!validation.success) {
    return sendError(
      res,
      400,
      validation.error.issues[0]?.message || 'بيانات المراجعة غير صحيحة.'
    );
  }

  const { decision, reason } = validation.data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[document]] = await connection.query(
      `
        SELECT
          cd.id,
          cd.current_version_no,
          c.employee_user_id,
          c.status AS candidate_status,
          co.title AS course_title,
          dr.title AS requirement_name,
          cdv.id AS version_id
        FROM candidate_documents cd
        INNER JOIN candidates c
          ON c.id = cd.candidate_id
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN document_requirements dr
          ON dr.id = cd.document_requirement_id
        LEFT JOIN candidate_document_versions cdv
          ON cdv.candidate_document_id = cd.id
          AND cdv.version_no = cd.current_version_no
        WHERE cd.id = ?
          AND cd.candidate_id = ?
          AND c.course_id = ?
        FOR UPDATE
      `,
      [documentId, candidateId, courseId]
    );

    if (!document) {
      throw new Error('المستند غير موجود.');
    }

    if (!document.version_id) {
      throw new Error('لا يمكن مراجعة مستند لم يتم رفعه بعد.');
    }

    await connection.query(
      `
        INSERT INTO candidate_document_reviews (
          candidate_document_version_id,
          reviewer_user_id,
          decision,
          rejection_reason
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        document.version_id,
        actorUserId,
        decision,
        decision === 'REJECTED' ? reason : null,
      ]
    );

    await connection.query(
      `
        UPDATE candidate_documents
        SET status = ?
        WHERE id = ?
      `,
      [
        decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        documentId,
      ]
    );

    if (decision === 'REJECTED') {
      if (document.candidate_status === 'DOCUMENTS_UNDER_REVIEW') {
        await connection.query(
          `
            UPDATE candidates
            SET status = 'DOCUMENTS_PENDING'
            WHERE id = ?
          `,
          [candidateId]
        );

        await connection.query(
          `
            INSERT INTO candidate_status_history (
              candidate_id,
              from_status,
              to_status,
              reason,
              changed_by_user_id
            )
            VALUES (?, 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING', ?, ?)
          `,
          [
            candidateId,
            'طلب إعادة رفع مستند.',
            actorUserId,
          ]
        );
      }

      await createNotification(connection, {
        recipientUserId: document.employee_user_id,
        senderUserId: actorUserId,
        notificationType: 'CANDIDATE_DOCUMENT_RESUBMISSION_REQUIRED',
        title: 'مطلوب إعادة رفع مستند',
        message: `المستند "${document.requirement_name}" يحتاج تعديلًا في دورة "${document.course_title}". الملاحظة: ${reason}`,
        relatedEntityType: 'CANDIDATE_DOCUMENT',
        relatedEntityId: Number(documentId),
      });
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: decision === 'APPROVED'
        ? 'CANDIDATE_DOCUMENT_APPROVED'
        : 'CANDIDATE_DOCUMENT_RESUBMISSION_REQUESTED',
      entityType: 'CANDIDATE_DOCUMENT',
      entityId: Number(documentId),
      afterData: { decision, reason },
    });

    await connection.commit();

    return res.json({
      message: decision === 'APPROVED'
        ? 'تم اعتماد المستند.'
        : 'تم إرسال طلب إعادة رفع المستند للموظف.',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Document review error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر مراجعة المستند.'
    );
  } finally {
    connection.release();
  }
}
async function reviewCandidateForm(req, res) {
  const { courseId, candidateId, formId } = req.params;
  const actorUserId = getActorId(req);

  const decision = String(req.body.decision || '').trim();
  const reason = String(req.body.reason || '').trim() || null;

  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return sendError(res, 400, 'قرار مراجعة الاستمارة غير صالح.');
  }

  if (decision === 'REJECTED' && !reason) {
    return sendError(res, 400, 'سبب رفض الاستمارة مطلوب.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[submission]] = await connection.query(
      `
        SELECT
          cfs.id,
          cfs.current_version_no,
          cfs.status,
          cf.title,
          c.employee_user_id,
          co.title AS course_title

        FROM candidate_form_submissions cfs
        INNER JOIN candidates c
          ON c.id = cfs.candidate_id
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN course_forms cf
          ON cf.id = cfs.course_form_id

      WHERE cfs.id = ?
  AND cfs.candidate_id = ?
  AND c.course_id = ?

        FOR UPDATE
      `,
[formId, candidateId, courseId]    );

    if (!submission) {
      throw new Error('الاستمارة غير موجودة ضمن هذا المرشح.');
    }

    if (!Number(submission.current_version_no)) {
      throw new Error('لا يمكن مراجعة استمارة لم يرفعها الموظف.');
    }

    await connection.query(
      `
        UPDATE candidate_form_submissions
        SET
          status = ?,
          reviewed_by_user_id = ?,
          reviewed_at = NOW(),
          rejection_reason = ?
        WHERE id = ?
      `,
      [
        decision,
        actorUserId,
        decision === 'REJECTED' ? reason : null,
        submission.id,
      ]
    );

    await createNotification(connection, {
      recipientUserId: submission.employee_user_id,
      senderUserId: actorUserId,
      notificationType:
        decision === 'APPROVED'
          ? 'COURSE_FORM_APPROVED'
          : 'COURSE_FORM_REJECTED',
      title:
        decision === 'APPROVED'
          ? 'تم اعتماد استمارتك'
          : 'مطلوب إعادة رفع استمارة',
      message:
        decision === 'APPROVED'
          ? `تم اعتماد استمارة "${submission.title}" للدورة: ${submission.course_title}.`
          : `تم رفض استمارة "${submission.title}" للدورة: ${submission.course_title}. السبب: ${reason}`,
      relatedEntityType: 'CANDIDATE_FORM_SUBMISSION',
      relatedEntityId: submission.id,
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'CANDIDATE_FORM_REVIEWED',
      entityType: 'CANDIDATE_FORM_SUBMISSION',
      entityId: submission.id,
      afterData: {
        decision,
        reason,
      },
    });

    await connection.commit();

    return res.json({
      message:
        decision === 'APPROVED'
          ? 'تم اعتماد الاستمارة.'
          : 'تم رفض الاستمارة وإشعار الموظف.',
    });
  } catch (error) {
    await connection.rollback();

    return sendError(
      res,
      400,
      error.message || 'تعذر مراجعة الاستمارة.'
    );
  } finally {
    connection.release();
  }
}

async function reviewProfileDocument(req, res) {
  const { courseId, candidateId, profileDocumentId } = req.params;
  const actorUserId = getActorId(req);

  const decision = String(req.body.decision || '').trim();
  const reason = String(req.body.reason || '').trim() || null;

  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return sendError(res, 400, 'قرار مراجعة المستند غير صالح.');
  }

  if (decision === 'REJECTED' && !reason) {
    return sendError(res, 400, 'سبب رفض المستند مطلوب.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[document]] = await connection.query(
      `
        SELECT
          pd.id,
          pd.label,
          pd.document_type,
          pdv.id AS profile_document_version_id,
          c.employee_user_id,
          co.title AS course_title

        FROM candidates c
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN profile_documents pd
          ON pd.user_profile_id = c.employee_user_id
          AND pd.deleted_at IS NULL
        INNER JOIN profile_document_versions pdv
          ON pdv.profile_document_id = pd.id
          AND pdv.version_no = (
            SELECT MAX(version_no)
            FROM profile_document_versions
            WHERE profile_document_id = pd.id
          )

        WHERE c.id = ?
          AND c.course_id = ?
          AND pd.id = ?

        FOR UPDATE
      `,
      [candidateId, courseId, profileDocumentId]
    );

    if (!document) {
      throw new Error('مستند الملف الشخصي غير موجود.');
    }

    await connection.query(
      `
        UPDATE profile_documents
        SET status = ?
        WHERE id = ?
      `,
      [decision, document.id]
    );

    await connection.query(
      `
        INSERT INTO profile_document_reviews (
          profile_document_version_id,
          reviewer_user_id,
          decision,
          rejection_reason
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        document.profile_document_version_id,
        actorUserId,
        decision,
        decision === 'REJECTED' ? reason : null,
      ]
    );

    await createNotification(connection, {
      recipientUserId: document.employee_user_id,
      senderUserId: actorUserId,
      notificationType:
        decision === 'APPROVED'
          ? 'PROFILE_DOCUMENT_APPROVED'
          : 'PROFILE_DOCUMENT_REJECTED',
      title:
        decision === 'APPROVED'
          ? 'تم اعتماد مستندك الشخصي'
          : 'مطلوب إعادة رفع مستند شخصي',
      message:
        decision === 'APPROVED'
          ? `تم اعتماد مستند "${document.label}" ضمن متطلبات الدورة: ${document.course_title}.`
          : `تم رفض مستند "${document.label}". السبب: ${reason}`,
      relatedEntityType: 'PROFILE_DOCUMENT',
      relatedEntityId: document.id,
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'PROFILE_DOCUMENT_REVIEWED',
      entityType: 'PROFILE_DOCUMENT',
      entityId: document.id,
      afterData: {
        decision,
        reason,
      },
    });

    await connection.commit();

    return res.json({
      message:
        decision === 'APPROVED'
          ? 'تم اعتماد المستند.'
          : 'تم رفض المستند وإشعار الموظف.',
    });
  } catch (error) {
    await connection.rollback();

    return sendError(
      res,
      400,
      error.message || 'تعذر مراجعة المستند الشخصي.'
    );
  } finally {
    connection.release();
  }
}
async function selectNominationCandidate(req, res) {
  const courseId = Number(req.params.courseId);
  const nominationId = Number(req.params.nominationId);

  if (
    !Number.isInteger(courseId) || courseId <= 0 ||
    !Number.isInteger(nominationId) || nominationId <= 0
  ) {
    return sendError(res, 400, 'معرّف الدورة أو الترشيح غير صالح.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[nomination]] = await connection.query(
      `
        SELECT n.id
        FROM nominations n
        LEFT JOIN candidates c
          ON c.source_nomination_id = n.id
        WHERE n.id = ?
          AND n.course_id = ?
          AND n.status = 'AGENT_CONFIRMED'
          AND c.id IS NULL
        FOR UPDATE
      `,
      [nominationId, courseId]
    );

    if (!nomination) {
      throw new Error(
        'الترشيح غير معتمد من الوكيل، أو اختارته اللجنة مسبقًا.'
      );
    }

    await connection.query(
      'SET @app_user_id = ?',
      [req.user.id]
    );

    await connection.query(
      'CALL sp_select_candidate_from_nomination(?)',
      [nominationId]
    );

    await connection.commit();

    return res.status(201).json({
      message: 'تم اختيار المرشح بنجاح.',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Select nomination candidate error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر اختيار المرشح.'
    );
  } finally {
    await connection.query('SET @app_user_id = NULL');
    connection.release();
  }
}
async function uploadCandidateAttachment(req, res) {
  const { courseId, candidateId } = req.params;
  const actorUserId = getActorId(req);

  const attachmentType = String(
    req.body.attachmentType || ''
  ).trim();

  const note = String(req.body.note || '').trim() || null;

  const allowedTypes = [
    'VISA',
    'TRAVEL_TICKET',
    'OFFICIAL_LETTER',
    'TRAVEL_DOCUMENT',
    'OTHER',
  ];

  if (!allowedTypes.includes(attachmentType)) {
    return sendError(res, 400, 'نوع المستند غير صالح.');
  }

  if (!req.file) {
    return sendError(res, 400, 'يرجى اختيار ملف للرفع.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[candidate]] = await connection.query(
      `
        SELECT
          c.id,
          c.employee_user_id,
          co.title AS course_title
        FROM candidates c
        INNER JOIN courses co
          ON co.id = c.course_id
        WHERE c.id = ?
          AND c.course_id = ?
        FOR UPDATE
      `,
      [candidateId, courseId]
    );

    if (!candidate) {
      throw new Error('المرشح غير موجود ضمن هذه الدورة.');
    }

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(req.file.path))
      .digest('hex');

const storageKey =
  `candidate-attachments/${req.file.filename}`;
      const originalName = normalizeOriginalName(req.file.originalname);

    const [fileResult] = await connection.query(
      `
        INSERT INTO files (
          storage_key,
          original_name,
          mime_type,
          size_bytes,
          checksum,
          uploaded_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        storageKey,
        originalName,
        req.file.mimetype,
        req.file.size,
        checksum,
        actorUserId,
      ]
    );

    const [attachmentResult] = await connection.query(
      `
        INSERT INTO candidate_attachments (
          candidate_id,
          attachment_type,
          file_id,
          uploaded_by_user_id,
          note
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        candidateId,
        attachmentType,
        fileResult.insertId,
        actorUserId,
        note,
      ]
    );

    await createNotification(connection, {
      recipientUserId: candidate.employee_user_id,
      senderUserId: actorUserId,
      notificationType: 'CANDIDATE_ATTACHMENT_SENT',
      title: 'تم إرسال مستند جديد لك',
      message: `تم إرسال مستند جديد للدورة: ${candidate.course_title}.`,
      relatedEntityType: 'CANDIDATE_ATTACHMENT',
      relatedEntityId: attachmentResult.insertId,
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'CANDIDATE_ATTACHMENT_UPLOADED',
      entityType: 'CANDIDATE_ATTACHMENT',
      entityId: attachmentResult.insertId,
      afterData: {
        course_id: Number(courseId),
        candidate_id: Number(candidateId),
        attachment_type: attachmentType,
        note,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message: 'تم رفع المستند وإرساله للمرشح بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    return sendError(
      res,
      400,
      error.message || 'تعذر رفع مستند المرشح.'
    );
  } finally {
    connection.release();
  }
}
module.exports = {
  listCourses,
  getOrganizationOptions,
  getEligibleEmployees,
  createCourse,
  getCourse,
  updateCourse,
  listCourseCandidates,
  addDirectCandidate,
  getCandidate,
  updateCandidateStatus,
  reviewCandidateDocument,
  reviewCandidateForm,
  reviewProfileDocument,
  uploadCandidateAttachment,
  selectNominationCandidate,
};