/** سجل دورات القسم الحالي للمدير، للقراءة فقط. */
const { attachFinalReports } = require('../../repositories/course-reports.repository');
module.exports = function createManagerArchive({ pool, getManagerDepartment, sendError }) {
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
      `(
        EXISTS (
          SELECT 1 FROM course_department_allocations allocation
          WHERE allocation.course_id = c.id AND allocation.department_id = ?
        )
        OR EXISTS (
          SELECT 1
          FROM candidates department_candidate
          INNER JOIN candidate_snapshots department_snapshot
            ON department_snapshot.candidate_id = department_candidate.id
          WHERE department_candidate.course_id = c.id
            AND CAST(JSON_UNQUOTE(JSON_EXTRACT(
              department_snapshot.organization_snapshot,
              '$.department_id'
            )) AS UNSIGNED) = ?
        )
      )`,
      `
        c.status IN ('COMPLETED', 'ARCHIVED')
      `,
    ];

    const values = [department.id, department.id];

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
            WHEN candidate.status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
              AND (
                n.department_id = ?
                OR CAST(JSON_UNQUOTE(JSON_EXTRACT(
                  cs.organization_snapshot,
                  '$.department_id'
                )) AS UNSIGNED) = ?
              )
            THEN candidate.id
          END) AS department_candidates_count

        FROM courses c
        LEFT JOIN candidates candidate
          ON candidate.course_id = c.id

        LEFT JOIN nominations n
          ON n.id = candidate.source_nomination_id

        LEFT JOIN candidate_snapshots cs
          ON cs.candidate_id = candidate.id

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
        department.id,
        department.id,
        ...values,
        limit,
        offset,
      ]
    );

    const [yearsRows] = await pool.execute(
      `
        SELECT DISTINCT YEAR(c.start_date) AS year
        FROM courses c
        WHERE (
          EXISTS (
            SELECT 1 FROM course_department_allocations allocation
            WHERE allocation.course_id = c.id AND allocation.department_id = ?
          )
          OR EXISTS (
            SELECT 1
            FROM candidates department_candidate
            INNER JOIN candidate_snapshots department_snapshot
              ON department_snapshot.candidate_id = department_candidate.id
            WHERE department_candidate.course_id = c.id
              AND CAST(JSON_UNQUOTE(JSON_EXTRACT(
                department_snapshot.organization_snapshot,
                '$.department_id'
              )) AS UNSIGNED) = ?
          )
        )
          AND c.start_date IS NOT NULL
          AND c.status IN ('COMPLETED', 'ARCHIVED')
        ORDER BY year DESC
      `,
      [department.id, department.id]
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
    console.error('Manager archive error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل سجل الدورات.'
    );
  }
}


return { getArchive };
};

