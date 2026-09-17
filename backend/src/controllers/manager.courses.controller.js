const pool = require('../config/database');

const {
  getManagerDepartment,
} = require('./manager.dashboard.controller');

const { writeAuditLog } = require('../utils/audit');
const { createNotification } = require('../utils/notifications');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function toFileUrl(storageKey) {
  const baseUrl =
    process.env.API_PUBLIC_URL || 'http://localhost:3000';

  return `${baseUrl}/uploads/${storageKey}`;
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

/*
  يتحقق من أن الدورة تخص قسم مدير القسم الحالي.
*/
async function ensureCourseInManagerDepartment(
  connection,
  courseId,
  managerUserId
) {
  const department = await getManagerDepartment(
    connection,
    managerUserId
  );

  if (!department) {
    throw new Error('لا يوجد قسم نشط معيّن لهذا المدير.');
  }

  const [rows] = await connection.execute(
    `
      SELECT
        c.id,
        c.course_no,
        c.course_type,
        c.title,
        c.description,
        c.provider,
        c.location,
        c.start_date,
        c.end_date,
        c.nomination_deadline,
        c.total_seats,
        c.status,

        cda.nomination_limit

      FROM courses c
      INNER JOIN course_department_allocations cda
        ON cda.course_id = c.id
      WHERE c.id = ?
        AND cda.department_id = ?
        AND c.deleted_at IS NULL
      LIMIT 1
    `,
    [courseId, department.id]
  );

  if (!rows.length) {
    throw new Error('الدورة غير موجودة أو لا تخص قسمك.');
  }

  return {
    department,
    course: rows[0],
  };
}

/*
  الموظفون الذين يحق لمدير القسم ترشيحهم:
  - موظفو القسم النشطون.
  - مدير القسم نفسه، حتى يستطيع ترشيح نفسه.
*/
async function getAvailableEmployees(
  connection,
  departmentId,
  managerUserId,
  courseId
) {
  const [employees] = await connection.execute(
    `
      SELECT DISTINCT
        u.id,
        up.full_name,
        up.employee_number,
        up.job_title,
        0 AS is_current_manager
      FROM employee_department_assignments eda
      INNER JOIN users u
        ON u.id = eda.employee_user_id
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      WHERE eda.department_id = ?
        AND eda.end_date IS NULL
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM nominations old_n
          WHERE old_n.course_id = ?
            AND old_n.nominee_user_id = u.id
            AND old_n.status NOT IN (
              'AGENT_REJECTED',
              'WITHDRAWN'
            )
        )

      UNION ALL

      SELECT
        manager_user.id,
        manager_profile.full_name,
        manager_profile.employee_number,
        manager_profile.job_title,
        1 AS is_current_manager
      FROM users manager_user
      INNER JOIN user_profiles manager_profile
        ON manager_profile.user_id = manager_user.id
      WHERE manager_user.id = ?
        AND manager_user.is_active = TRUE
        AND manager_user.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM nominations old_n
          WHERE old_n.course_id = ?
            AND old_n.nominee_user_id = manager_user.id
            AND old_n.status NOT IN (
              'AGENT_REJECTED',
              'WITHDRAWN'
            )
        )

      ORDER BY full_name ASC
    `,
    [
      departmentId,
      courseId,
      managerUserId,
      courseId,
    ]
  );

  return employees;
}

/*
  يعرض فقط الدورات المتاحة للقسم.
*/
async function listCourses(req, res) {
  try {
    const department = await getManagerDepartment(
      pool,
      req.user.id
    );

    if (!department) {
      return sendError(
        res,
        403,
        'لا يوجد قسم نشط معيّن لهذا المدير.'
      );
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 9, 1),
      50
    );

    const offset = (page - 1) * limit;

    const search = String(req.query.search || '').trim();
    const type = String(req.query.type || '').trim();
    const status = String(req.query.status || '').trim();

    const conditions = [
      'c.deleted_at IS NULL',
      'cda.department_id = ?',
      `
        c.status NOT IN (
          'COMPLETED',
          'ARCHIVED',
          'CANCELLED'
        )
      `,
    ];

    const values = [department.id];

    if (search) {
      conditions.push(`
        (
          c.course_no LIKE ?
          OR c.title LIKE ?
        )
      `);

      const searchValue = `%${search}%`;
      values.push(searchValue, searchValue);
    }

    if (type === 'TRAINING' || type === 'MISSION') {
      conditions.push('c.course_type = ?');
      values.push(type);
    }

    if (status) {
      conditions.push('c.status = ?');
      values.push(status);
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.query(
      `
        SELECT COUNT(DISTINCT c.id) AS total
        FROM courses c
        INNER JOIN course_department_allocations cda
          ON cda.course_id = c.id
        WHERE ${whereClause}
      `,
      values
    );

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
          c.status,

          COUNT(DISTINCT n.id) AS department_nominations_count,

          MAX(
            CASE
              WHEN n.nominated_by_user_id = ?
              THEN 1
              ELSE 0
            END
          ) AS submission_locked

        FROM courses c
        INNER JOIN course_department_allocations cda
          ON cda.course_id = c.id

        LEFT JOIN nominations n
          ON n.course_id = c.id
          AND n.department_id = cda.department_id
          AND n.nominated_by_user_id = ?

        WHERE ${whereClause}

        GROUP BY
          c.id,
          c.course_no,
          c.course_type,
          c.title,
          c.description,
          c.start_date,
          c.end_date,
          c.status

        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [
        req.user.id,
        req.user.id,
        ...values,
        limit,
        offset,
      ]
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      courses: courses.map((course) => ({
        ...course,
        submission_locked: Boolean(course.submission_locked),
      })),

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Manager list courses error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل دورات القسم.'
    );
  }
}

async function getCourse(req, res) {
  try {
    const courseId = Number(req.params.courseId);

    if (!Number.isInteger(courseId) || courseId <= 0) {
      return sendError(res, 400, 'معرّف الدورة غير صالح.');
    }

    const {
      department,
      course,
    } = await ensureCourseInManagerDepartment(
      pool,
      courseId,
      req.user.id
    );

    const [
      [allocationRows],
      [nominations],
      [attachments],
      [courseForms],
      [selfCandidateRows],
    ] = await Promise.all([
      pool.execute(
        `
          SELECT
            cda.nomination_limit,

            COUNT(n.id) AS nominations_count

          FROM course_department_allocations cda
          LEFT JOIN nominations n
            ON n.course_id = cda.course_id
            AND n.department_id = cda.department_id
            AND n.status NOT IN ('WITHDRAWN')

          WHERE cda.course_id = ?
            AND cda.department_id = ?

          GROUP BY cda.nomination_limit
        `,
        [courseId, department.id]
      ),

      pool.execute(
        `
          SELECT
            n.id,
            n.status,
            n.created_at,
            n.reason,

            up.full_name AS employee_name,
            up.employee_number

          FROM nominations n
          INNER JOIN user_profiles up
            ON up.user_id = n.nominee_user_id

          WHERE n.course_id = ?
            AND n.department_id = ?
            AND n.nominated_by_user_id = ?

          ORDER BY n.created_at DESC
        `,
        [
          courseId,
          department.id,
          req.user.id,
        ]
      ),

      pool.execute(
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
      ),

      pool.execute(
        `
          SELECT
            cf.id,
            cf.title,
            cf.is_required,
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
      ),

      /*
        مدير القسم مرشح لنفسه:
        إما Candidate بعد اعتماد الوكيل،
        أو Nomination قيد الانتظار أو معتمد.
      */
      pool.execute(
        `
          SELECT
            EXISTS (
              SELECT 1
              FROM nominations n
              WHERE n.course_id = ?
                AND n.nominee_user_id = ?
                AND n.department_id = ?
                AND n.status NOT IN (
                  'AGENT_REJECTED',
                  'WITHDRAWN'
                )
            ) AS self_candidate
        `,
        [
          courseId,
          req.user.id,
          department.id,
        ]
      ),
    ]);

    const availableEmployees = await getAvailableEmployees(
      pool,
      department.id,
      req.user.id,
      courseId
    );

    const submissionLocked = nominations.length > 0;

    return res.json({
      department,
      course,

      departmentAllocation: {
        nomination_limit: Number(
          allocationRows[0]?.nomination_limit || 0
        ),

        nominations_count: Number(
          allocationRows[0]?.nominations_count || 0
        ),
      },

      submission_locked: submissionLocked,

      availableEmployees: submissionLocked
        ? []
        : availableEmployees,

      nominations,

      selfCandidate: Boolean(
        selfCandidateRows[0]?.self_candidate
      ),

      selfCourseForms: courseForms.map((form) => ({
        ...form,
        template_file_url: toFileUrl(form.storage_key),
      })),

      attachments: attachments.map((attachment) => ({
        ...attachment,
        file_url: toFileUrl(attachment.storage_key),
      })),
    });
  } catch (error) {
    console.error('Manager get course error:', error);

    return sendError(
      res,
      403,
      error.message || 'تعذر تحميل تفاصيل الدورة.'
    );
  }
}

/*
  يرسل مدير القسم قائمة الترشيحات دفعة واحدة إلى وكيل القطاع.
  بعد نجاح العملية، لا يسمح بإضافة أو حذف مرشحين من هذه الدورة.
*/
async function submitNominations(req, res) {
  const courseId = Number(req.params.courseId);

  const employeeUserIds = Array.isArray(req.body.employeeUserIds)
    ? [...new Set(req.body.employeeUserIds.map(Number))]
    : [];

  if (!Number.isInteger(courseId) || courseId <= 0) {
    return sendError(res, 400, 'معرّف الدورة غير صالح.');
  }

  if (
    !employeeUserIds.length ||
    employeeUserIds.some(
      (id) => !Number.isInteger(id) || id <= 0
    )
  ) {
    return sendError(
      res,
      400,
      'حدد موظفًا واحدًا على الأقل للترشيح.'
    );
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      department,
      course,
    } = await ensureCourseInManagerDepartment(
      connection,
      courseId,
      req.user.id
    );

    if (course.course_type !== 'TRAINING') {
      throw new Error(
        'الترشيح من مدير القسم متاح للدورات التدريبية فقط.'
      );
    }

    if (course.status !== 'OPEN_FOR_NOMINATION') {
      throw new Error(
        'هذه الدورة غير مفتوحة للترشيح حاليًا.'
      );
    }

    const [[existingSubmission]] = await connection.execute(
      `
        SELECT id
        FROM nominations
        WHERE course_id = ?
          AND department_id = ?
          AND nominated_by_user_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [
        courseId,
        department.id,
        req.user.id,
      ]
    );

    if (existingSubmission) {
      throw new Error(
        'تم إرسال ترشيحات القسم مسبقًا، ولا يمكن تعديلها الآن.'
      );
    }

    const [agentRows] = await connection.execute(
      `
        SELECT
          saa.agent_user_id
        FROM department_manager_assignments dma
        INNER JOIN sector_agent_assignments saa
          ON saa.id = dma.agent_assignment_id
          AND saa.end_date IS NULL
        INNER JOIN users agent_user
          ON agent_user.id = saa.agent_user_id
        WHERE dma.manager_user_id = ?
          AND dma.department_id = ?
          AND dma.end_date IS NULL
          AND agent_user.is_active = TRUE
          AND agent_user.deleted_at IS NULL
        LIMIT 1
      `,
      [
        req.user.id,
        department.id,
      ]
    );

    if (!agentRows.length) {
      throw new Error(
        'لا يوجد وكيل قطاع نشط مرتبط بهذا القسم.'
      );
    }

    const agentUserId = agentRows[0].agent_user_id;

    const [employeeRows] = await connection.query(
      `
        SELECT DISTINCT u.id
        FROM (
          SELECT
            eda.employee_user_id AS id
          FROM employee_department_assignments eda
          INNER JOIN users u
            ON u.id = eda.employee_user_id
          WHERE eda.department_id = ?
            AND eda.end_date IS NULL
            AND u.is_active = TRUE
            AND u.deleted_at IS NULL

          UNION

          SELECT ?
        ) permitted_users
        INNER JOIN users u
          ON u.id = permitted_users.id
        WHERE u.is_active = TRUE
          AND u.deleted_at IS NULL
          AND permitted_users.id IN (?)
      `,
      [
        department.id,
        req.user.id,
        employeeUserIds,
      ]
    );

    if (employeeRows.length !== employeeUserIds.length) {
      throw new Error(
        'يوجد موظف غير تابع للقسم أو حسابه غير نشط.'
      );
    }

    if (employeeUserIds.length > Number(course.nomination_limit)) {
      throw new Error(
        `لا يمكن تجاوز حد ترشيحات القسم: ${course.nomination_limit}.`
      );
    }

    for (const employeeUserId of employeeUserIds) {
      await connection.execute(
        `
          INSERT INTO nominations (
            course_id,
            nominee_user_id,
            department_id,
            nominated_by_user_id,
            agent_user_id,
            status
          )
          VALUES (?, ?, ?, ?, ?, 'PENDING_AGENT')
        `,
        [
          courseId,
          employeeUserId,
          department.id,
          req.user.id,
          agentUserId,
        ]
      );
    }

    await createNotification(connection, {
      recipientUserId: agentUserId,
      senderUserId: req.user.id,
      notificationType: 'DEPARTMENT_NOMINATIONS_SUBMITTED',
      title: 'ترشيحات جديدة تحتاج مراجعة',
      message: `أرسل مدير قسم "${department.name}" ${employeeUserIds.length} ترشيحًا للدورة: ${course.title}.`,
      relatedEntityType: 'COURSE',
      relatedEntityId: courseId,
    });

    await writeAuditLog(connection, {
      actorUserId: req.user.id,
      eventType: 'DEPARTMENT_NOMINATIONS_SUBMITTED',
      entityType: 'COURSE',
      entityId: courseId,
      afterData: {
        department_id: department.id,
        nominated_employee_ids: employeeUserIds,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message:
        'تم إرسال ترشيحات القسم إلى وكيل القطاع للمراجعة.',
    });
  } catch (error) {
    await connection.rollback();

    console.error('Manager submit nominations error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(
        res,
        400,
        'يوجد موظف تم ترشيحه مسبقًا لهذه الدورة.'
      );
    }

    return sendError(
      res,
      400,
      error.message || 'تعذر إرسال الترشيحات.'
    );
  } finally {
    connection.release();
  }
}

async function getArchive(req, res) {
  try {
    const department = await getManagerDepartment(
      pool,
      req.user.id
    );

    if (!department) {
      return sendError(
        res,
        403,
        'لا يوجد قسم نشط معيّن لهذا المدير.'
      );
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 12, 1),
      50
    );

    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const courseType = String(req.query.courseType || '').trim();
    const year = String(req.query.year || '').trim();

    const conditions = [
      'c.deleted_at IS NULL',
      'cda.department_id = ?',
      `
        c.status IN (
          'COMPLETED',
          'ARCHIVED',
          'CANCELLED'
        )
      `,
    ];

    const values = [department.id];

    if (search) {
      conditions.push(`
        (
          c.course_no LIKE ?
          OR c.title LIKE ?
        )
      `);

      const searchValue = `%${search}%`;
      values.push(searchValue, searchValue);
    }

    if (
      courseType === 'TRAINING' ||
      courseType === 'MISSION'
    ) {
      conditions.push('c.course_type = ?');
      values.push(courseType);
    }

    if (/^\d{4}$/.test(year)) {
      conditions.push('YEAR(c.start_date) = ?');
      values.push(Number(year));
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.query(
      `
        SELECT COUNT(DISTINCT c.id) AS total
        FROM courses c
        INNER JOIN course_department_allocations cda
          ON cda.course_id = c.id
        WHERE ${whereClause}
      `,
      values
    );

    const [courses] = await pool.query(
      `
        SELECT
          c.id,
          c.course_no,
          c.title,
          c.course_type,
          c.start_date,
          c.end_date,
          c.status,

          COUNT(DISTINCT candidate.id) AS department_candidates_count

        FROM courses c
        INNER JOIN course_department_allocations cda
          ON cda.course_id = c.id

        LEFT JOIN nominations n
          ON n.course_id = c.id
          AND n.department_id = cda.department_id

        LEFT JOIN candidates candidate
          ON candidate.source_nomination_id = n.id

        WHERE ${whereClause}

        GROUP BY
          c.id,
          c.course_no,
          c.title,
          c.course_type,
          c.start_date,
          c.end_date,
          c.status

        ORDER BY c.end_date DESC, c.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [
        ...values,
        limit,
        offset,
      ]
    );

    const [yearsRows] = await pool.execute(
      `
        SELECT DISTINCT YEAR(c.start_date) AS year
        FROM courses c
        INNER JOIN course_department_allocations cda
          ON cda.course_id = c.id
        WHERE cda.department_id = ?
          AND c.start_date IS NOT NULL
          AND c.status IN (
            'COMPLETED',
            'ARCHIVED',
            'CANCELLED'
          )
        ORDER BY year DESC
      `,
      [department.id]
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      years: yearsRows
        .map((row) => row.year)
        .filter(Boolean),

      courses,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Manager archive error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل سجل الدورات.'
    );
  }
}

module.exports = {
  listCourses,
  getCourse,
  submitNominations,
  getArchive,
};