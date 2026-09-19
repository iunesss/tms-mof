/** سجل دورات القسم الحالي للمدير، للقراءة فقط. */
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


return { getArchive };
};

