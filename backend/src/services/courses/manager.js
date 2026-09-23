const pool = require('../../config/database');
const { attachFinalReports } = require('../../repositories/course-reports.repository');

const {
  getManagerDepartment,
} = require('../../repositories/assignments.repository');

const { writeAuditLog } = require('../../utils/audit');
const { createNotification } = require('../../utils/notifications');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function toFileUrl(storageKey) {
  const baseUrl =
    process.env.API_PUBLIC_URL || 'http://localhost:3000';

  return `${baseUrl}/uploads/${storageKey}`;
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
    throw new Error('لا يوجد قسم نشط مرتبط بحساب مدير القسم.');
  }

  const [[course]] = await connection.query(
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

      LEFT JOIN course_department_allocations cda
        ON cda.course_id = c.id
        AND cda.department_id = ?

      WHERE c.id = ?
        AND c.deleted_at IS NULL
        AND (
          (
            c.course_type = 'TRAINING'
            AND cda.id IS NOT NULL
          )
          OR
          (
            c.course_type = 'MISSION'
            AND EXISTS (
              SELECT 1
              FROM candidates mission_candidate
              INNER JOIN candidate_snapshots mission_snapshot
                ON mission_snapshot.candidate_id = mission_candidate.id
              WHERE mission_candidate.course_id = c.id
                AND mission_candidate.status NOT IN (
                  'REJECTED',
                  'WITHDRAWN',
                  'REMOVED',
                  'CANCELLED'
                )
                AND CAST(
                  JSON_UNQUOTE(
                    JSON_EXTRACT(
                      mission_snapshot.organization_snapshot,
                      '$.department_id'
                    )
                  ) AS UNSIGNED
                ) = ?
            )
          )
        )
    `,
    [
      department.id,
      courseId,
      department.id,
    ]
  );

  if (!course) {
    throw new Error(
      'الدورة غير موجودة أو لا تخص القسم المرتبط بحسابك.'
    );
  }

  return {
    course,
    department,
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
  const [employees] = await connection.query(
    `
      SELECT DISTINCT
        u.id,
        up.full_name,
        up.employee_number,
        up.job_title,
        CASE
          WHEN u.id = ? THEN 1
          ELSE 0
        END AS is_department_manager

      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id

      LEFT JOIN employee_department_assignments eda
        ON eda.employee_user_id = u.id
        AND eda.end_date IS NULL

      WHERE u.is_active = 1
        AND u.deleted_at IS NULL
        AND (
          eda.department_id = ?
          OR u.id = ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM nominations n
          WHERE n.course_id = ?
            AND n.nominee_user_id = u.id
            AND n.status NOT IN (
              'AGENT_REJECTED',
              'WITHDRAWN',
              'CANCELLED',
              'REJECTED'
            )
        )

      ORDER BY
        is_department_manager DESC,
        up.full_name ASC
    `,
    [
      managerUserId,
      departmentId,
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

    const isMission = course.course_type === 'MISSION';
    const isClosedCourse = [
      'COMPLETED',
      'ARCHIVED',
      'CANCELLED',
    ].includes(course.status);

    const [
      allocationResult,
      nominationsResult,
      attachmentsResult,
      selfCandidateResult,
      selfNominationResult,
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
            AND n.status NOT IN ('AGENT_REJECTED', 'WITHDRAWN')

          WHERE cda.course_id = ?
            AND cda.department_id = ?

          GROUP BY cda.nomination_limit
        `,
        [courseId, department.id]
      ),

      /*
        في التدريب: ترشيحات مدير القسم.
        في المهمة: الموظفون الموجودون فعليًا في المهمة من نفس القسم.
      */
      (isMission || isClosedCourse)
        ? pool.execute(
            `
              SELECT
                c.id,
                c.status,
                c.created_at,
                NULL AS reason,

                up.full_name AS employee_name,
                up.employee_number

              FROM candidates c
              INNER JOIN candidate_snapshots cs
                ON cs.candidate_id = c.id
              INNER JOIN user_profiles up
                ON up.user_id = c.employee_user_id

              WHERE c.course_id = ?
                AND c.status NOT IN (
                  'REJECTED',
                  'WITHDRAWN',
                  'REMOVED',
                  'CANCELLED'
                )
                AND CAST(
                  JSON_UNQUOTE(
                    JSON_EXTRACT(
                      cs.organization_snapshot,
                      '$.department_id'
                    )
                  ) AS UNSIGNED
                ) = ?

              ORDER BY c.created_at DESC
            `,
            [courseId, department.id]
          )
        : pool.execute(
            `
              SELECT
                n.id,
                n.status,
                n.created_at,
                NULL AS reason,

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
          SELECT id, status, selected_at, confirmed_at
          FROM candidates
          WHERE course_id = ?
            AND employee_user_id = ?
            AND status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
          LIMIT 1
        `,
        [courseId, req.user.id]
      ),

      pool.execute(
        `
          SELECT id, status
          FROM nominations
          WHERE course_id = ?
            AND nominee_user_id = ?
            AND department_id = ?
            AND status NOT IN ('AGENT_REJECTED', 'WITHDRAWN')
          ORDER BY id DESC
          LIMIT 1
        `,
        [courseId, req.user.id, department.id]
      ),
    ]);

    const [allocationRows] = allocationResult;
    const [nominations] = nominationsResult;
    const [attachments] = attachmentsResult;
    const [selfCandidateRows] = selfCandidateResult;
    const [selfNominationRows] = selfNominationResult;
    const selfCandidate = selfCandidateRows[0] || null;
    const selfNomination = selfNominationRows[0] || null;

    let selfForms = [];
    let selfCandidateAttachments = [];

    if (selfCandidate) {
      [selfForms] = await pool.execute(
        `
          SELECT cf.id, cf.title, cf.is_required,
                 template_file.storage_key AS template_storage_key,
                 cfs.status AS submission_status,
                 submitted_file.storage_key AS submitted_storage_key
          FROM course_forms cf
          INNER JOIN files template_file ON template_file.id = cf.template_file_id
          LEFT JOIN candidate_form_submissions cfs
            ON cfs.course_form_id = cf.id AND cfs.candidate_id = ?
          LEFT JOIN form_submission_versions fsv
            ON fsv.candidate_form_submission_id = cfs.id
            AND fsv.version_no = cfs.current_version_no
          LEFT JOIN files submitted_file ON submitted_file.id = fsv.file_id
          WHERE cf.course_id = ?
            AND cf.deleted_at IS NULL
            AND template_file.deleted_at IS NULL
          ORDER BY cf.display_order, cf.created_at
        `,
        [selfCandidate.id, courseId]
      );

      [selfCandidateAttachments] = await pool.execute(
        `
          SELECT ca.id, ca.attachment_type, ca.note, f.original_name, f.storage_key
          FROM candidate_attachments ca
          INNER JOIN files f ON f.id = ca.file_id
          WHERE ca.candidate_id = ?
            AND ca.deleted_at IS NULL
            AND f.deleted_at IS NULL
          ORDER BY ca.created_at DESC
        `,
        [selfCandidate.id]
      );
    }

    /*
      فقط الدورات التدريبية تسمح باختيار موظفين.
      المهمة لا يظهر فيها هذا القسم نهائيًا.
    */
    const availableEmployees = isMission
      ? []
      : await getAvailableEmployees(
          pool,
          department.id,
          req.user.id,
          courseId
        );

    const nominationLimit = Number(
      allocationRows[0]?.nomination_limit || 0
    );
    const nominationsCount = Number(
      allocationRows[0]?.nominations_count || 0
    );
    const deadlinePassed = course.nomination_deadline
      ? new Date(course.nomination_deadline).setHours(23, 59, 59, 999) < Date.now()
      : true;
    const submissionLocked =
      isMission ||
      course.status !== 'OPEN_FOR_NOMINATION' ||
      deadlinePassed ||
      nominationsCount >= nominationLimit ||
      availableEmployees.length === 0;

    const [courseWithReport] = await attachFinalReports(pool, [course]);
    return res.json({
      department,
      course,
      final_report: courseWithReport.final_report,

      /*
        يستعمله الـ JavaScript لإخفاء كل أزرار الترشيح
        في المهمة أو البعثة.
      */
      read_only: isMission,

      departmentAllocation: {
        nomination_limit: nominationLimit,

        nominations_count: nominationsCount,
      },

      submission_locked: submissionLocked,

      availableEmployees: submissionLocked
        ? []
        : availableEmployees,

      nominations,

      participants_only: isMission || isClosedCourse,

      selfCandidate: Boolean(selfCandidate),

      selfParticipation: selfCandidate
        ? { type: 'CANDIDATE', status: selfCandidate.status }
        : selfNomination
          ? { type: 'NOMINATION', status: selfNomination.status }
          : null,

      /*
        لا نعرض استمارات شخصية لمدير القسم داخل المهمة.
      */
      selfCourseForms: selfCandidate
        ? selfForms.map((form) => ({
            ...form,
            template_file_url: toFileUrl(form.template_storage_key),
            submitted_file_url: form.submitted_storage_key
              ? toFileUrl(form.submitted_storage_key)
              : null,
          }))
        : [],

      selfCandidateAttachments: selfCandidateAttachments.map((attachment) => ({
        ...attachment,
        file_url: toFileUrl(attachment.storage_key),
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
const { submitNominations } = require('./manager-nominations')({
  pool, writeAuditLog, createNotification, sendError, ensureCourseInManagerDepartment,
});
const { getArchive } = require('./manager-archive')({ pool, getManagerDepartment, sendError });

module.exports = { listCourses, getCourse, submitNominations, getArchive };


