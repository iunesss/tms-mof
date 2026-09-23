const pool = require('../../config/database');
const { attachFinalReports } = require('../../repositories/course-reports.repository');
const { notifyCourseManagers } = require('../../utils/notifications');
const {
  getAgentSector,
} = require('../../repositories/assignments.repository');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function toFileUrl(storageKey) {
  const baseUrl =
    process.env.API_PUBLIC_URL || 'http://localhost:3000';

  return `${baseUrl}/uploads/${storageKey}`;
}

async function ensureCourseInAgentSector(
  connection,
  courseId,
  agentUserId
) {
  const sector = await getAgentSector(connection, agentUserId);

  if (!sector) {
    throw new Error('لا يوجد قطاع نشط معيّن لهذا الوكيل.');
  }

  const [courses] = await connection.execute(
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
        c.status
      FROM courses c
      INNER JOIN course_sector_targets cst
        ON cst.course_id = c.id
      WHERE c.id = ?
        AND cst.sector_id = ?
        AND c.deleted_at IS NULL
      LIMIT 1
    `,
    [courseId, sector.id]
  );

  if (!courses.length) {
    throw new Error(
      'الدورة غير موجودة أو لا تخص قطاعك.'
    );
  }

  return {
    sector,
    course: courses[0],
  };
}

async function listCourses(req, res) {
  try {
    const sector = await getAgentSector(pool, req.user.id);

    if (!sector) {
      return sendError(
        res,
        403,
        'لا يوجد قطاع نشط معيّن لهذا الوكيل.'
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
      'cst.sector_id = ?',
      `c.status NOT IN (
        'COMPLETED',
        'ARCHIVED',
        'CANCELLED'
      )`,
    ];

    const values = [sector.id];

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
        INNER JOIN course_sector_targets cst
          ON cst.course_id = c.id
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
          COUNT(DISTINCT n.id) AS pending_nominations
        FROM courses c
        INNER JOIN course_sector_targets cst
          ON cst.course_id = c.id
        LEFT JOIN departments d
          ON d.sector_id = cst.sector_id
        LEFT JOIN nominations n
          ON n.course_id = c.id
          AND n.department_id = d.id
          AND n.status = 'SUBMITTED'
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
      [...values, limit, offset]
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      courses,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Agent list courses error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل دورات القطاع.'
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
      sector,
      course,
    } = await ensureCourseInAgentSector(
      pool,
      courseId,
      req.user.id
    );

    const [
      [allocationRows],
      [nominations],
      [attachments],
      [participants],
    ] = await Promise.all([
      pool.execute(
        `
          SELECT
            COALESCE(SUM(cda.nomination_limit), 0) AS nomination_limit,

            COUNT(
              DISTINCT CASE
                WHEN n.status NOT IN (
                  'AGENT_REJECTED',
                  'WITHDRAWN'
                )
              THEN n.id
              END
            ) AS nominations_count

          FROM course_department_allocations cda
          INNER JOIN departments d
            ON d.id = cda.department_id
          LEFT JOIN nominations n
            ON n.course_id = cda.course_id
            AND n.department_id = cda.department_id
          WHERE cda.course_id = ?
            AND d.sector_id = ?
        `,
        [courseId, sector.id]
      ),

      pool.execute(
        `
          SELECT
            n.id,
            n.status,
            n.created_at,

            employee_profile.full_name AS employee_name,
            employee_profile.employee_number,

            d.name AS department_name,
            manager_profile.full_name AS manager_name

          FROM nominations n
          INNER JOIN departments d
            ON d.id = n.department_id

          INNER JOIN user_profiles employee_profile
            ON employee_profile.user_id = n.nominee_user_id

          LEFT JOIN user_profiles manager_profile
            ON manager_profile.user_id = n.nominated_by_user_id

          WHERE n.course_id = ?
            AND d.sector_id = ?
            AND n.status NOT IN ('WITHDRAWN')

          ORDER BY
            n.agent_decided_by_user_id IS NULL DESC,
            n.created_at DESC
        `,
        [courseId, sector.id]
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
        `SELECT candidate.id, candidate.status, profile.full_name,
                profile.employee_number, department.name AS department_name
         FROM candidates candidate
         JOIN user_profiles profile ON profile.user_id = candidate.employee_user_id
         LEFT JOIN nominations source_nomination ON source_nomination.id = candidate.source_nomination_id
         LEFT JOIN candidate_snapshots snapshot ON snapshot.candidate_id = candidate.id
         JOIN departments department ON department.id = COALESCE(
           source_nomination.department_id,
           CAST(JSON_UNQUOTE(JSON_EXTRACT(snapshot.organization_snapshot, '$.department_id')) AS UNSIGNED)
         )
         WHERE candidate.course_id = ? AND department.sector_id = ?
           AND candidate.status IN ('CONFIRMED', 'PARTICIPATING', 'COMPLETED')
         ORDER BY profile.full_name`,
        [courseId, sector.id]
      ),
    ]);

    const [courseWithReport] = await attachFinalReports(pool, [course]);
    return res.json({
      sector,
      course,
      final_report: courseWithReport.final_report,

      sectorAllocation: {
        nomination_limit: Number(
          allocationRows[0]?.nomination_limit || 0
        ),

        nominations_count: Number(
          allocationRows[0]?.nominations_count || 0
        ),
      },

      nominations: ['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(course.status) ? [] : nominations,
      participants,

      attachments: attachments.map((attachment) => ({
        ...attachment,
        file_url: toFileUrl(attachment.storage_key),
      })),
    });
  } catch (error) {
    console.error('Agent get course error:', error);

    return sendError(
      res,
      403,
      error.message || 'تعذر تحميل تفاصيل الدورة.'
    );
  }
}

/*
  يعتمد الترشيحات التي حددها الوكيل.
  الإجراء المخزن هو المسؤول عن:
  - التحقق من صلاحية الوكيل.
  - تغيير حالة الترشيح.
  - إنشاء Candidate عند القبول.
  - حفظ السجل والإشعار.
*/
async function decideNominations(req, res) {
  const courseId = Number(req.params.courseId);
  const { nominationIds, isConfirmed, reason = null } = req.body;

  if (!Number.isInteger(courseId) || courseId <= 0) {
    return sendError(res, 400, 'معرّف الدورة غير صالح.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { sector, course } = await ensureCourseInAgentSector(
      connection,
      courseId,
      req.user.id
    );
    if (['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(course.status)) {
      throw new Error('لا يمكن مراجعة ترشيحات دورة منتهية أو ملغاة.');
    }

    const placeholders = nominationIds.map(() => '?').join(',');

    const [nominations] = await connection.query(
      `
        SELECT n.id
        FROM nominations n
        INNER JOIN departments d
          ON d.id = n.department_id
        WHERE n.id IN (${placeholders})
          AND n.course_id = ?
          AND d.sector_id = ?
          AND n.agent_decided_by_user_id IS NULL
         AND n.status = 'SUBMITTED'
        FOR UPDATE
      `,
      [
        ...nominationIds,
        courseId,
        sector.id,
      ]
    );

    if (nominations.length !== nominationIds.length) {
      throw new Error(
        'يوجد ترشيح غير صالح أو تم اتخاذ قرار عليه مسبقًا.'
      );
    }

    await connection.query(
      'SET @app_user_id = ?',
      [req.user.id]
    );

    for (const nomination of nominations) {
      await connection.query(
        `
          CALL sp_agent_decide_nomination(
            ?,
            ?,
            ?
          )
        `,
        [
          nomination.id,
          isConfirmed,
          isConfirmed ? null : reason,
        ]
      );
    }

    // الإجراء المخزن يبلغ مدير الدورة بكل اعتماد؛ نضيف الرفض هنا لأنه لا يبلغه به.
    if (!isConfirmed) {
      await notifyCourseManagers(connection, {
        senderUserId: req.user.id,
        notificationType: 'NOMINATIONS_AGENT_REJECTED',
        title: 'رفض الوكيل بعض الترشيحات',
        message: `رفض وكيل قطاع "${sector.name}" ${nominations.length} ترشيحًا في الدورة "${course.title}". السبب: ${reason}`,
        relatedEntityType: 'COURSE',
        relatedEntityId: courseId,
      });
    }

    await connection.commit();

    return res.json({
      message: isConfirmed
        ? 'تم اعتماد المرشحين المحددين بنجاح.'
        : 'تم رفض المرشحين المحددين بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    console.error('Agent nomination decision error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر تنفيذ القرار على الترشيحات.'
    );
  } finally {
    connection.release();
  }
}

async function getArchive(req, res) {
  try {
    const sector = await getAgentSector(pool, req.user.id);

    if (!sector) {
      return sendError(
        res,
        403,
        'لا يوجد قطاع نشط معيّن لهذا الوكيل.'
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
      'cst.sector_id = ?',
      `c.status IN ('COMPLETED', 'ARCHIVED')`,
    ];

    const values = [sector.id];

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
        INNER JOIN course_sector_targets cst
          ON cst.course_id = c.id
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

          COUNT(DISTINCT CASE
            WHEN candidate.status IN ('CONFIRMED', 'PARTICIPATING', 'COMPLETED')
              AND EXISTS (
                SELECT 1 FROM departments candidate_department
                WHERE candidate_department.sector_id = cst.sector_id
                  AND candidate_department.id = COALESCE(
                    source_nomination.department_id,
                    CAST(JSON_UNQUOTE(JSON_EXTRACT(snapshots.organization_snapshot, '$.department_id')) AS UNSIGNED)
                  )
              )
            THEN candidate.id
          END) AS sector_candidates_count

        FROM courses c
        INNER JOIN course_sector_targets cst
          ON cst.course_id = c.id

        LEFT JOIN candidates candidate
          ON candidate.course_id = c.id

        LEFT JOIN nominations source_nomination
          ON source_nomination.id = candidate.source_nomination_id

        LEFT JOIN candidate_snapshots snapshots
          ON snapshots.candidate_id = candidate.id

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
      [...values, limit, offset]
    );

    const [yearsRows] = await pool.execute(
      `
        SELECT DISTINCT YEAR(c.start_date) AS year
        FROM courses c
        INNER JOIN course_sector_targets cst
          ON cst.course_id = c.id
        WHERE cst.sector_id = ?
          AND c.start_date IS NOT NULL
          AND c.status IN ('COMPLETED', 'ARCHIVED')
        ORDER BY year DESC
      `,
      [sector.id]
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      years: yearsRows
        .map((row) => row.year)
        .filter(Boolean),

      courses: await attachFinalReports(pool, courses),

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Agent archive error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل أرشيف القطاع.'
    );
  }
}

module.exports = {
  listCourses,
  getCourse,
decideNominations,
getArchive,
};
