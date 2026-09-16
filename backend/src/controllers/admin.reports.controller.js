const pool = require('../config/database');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function getAuditLogs(req, res) {
  try {
    const page = positiveNumber(req.query.page, 1);
    const limit = Math.min(positiveNumber(req.query.limit, 15), 100);
    const offset = (page - 1) * limit;

    const search = String(req.query.search || '').trim();
    const eventType = String(req.query.eventType || '').trim();
    const entityType = String(req.query.entityType || '').trim();
    const date = String(req.query.date || '').trim();

    const conditions = ['1 = 1'];
    const values = [];

    if (search) {
      const searchValue = `%${search}%`;

      conditions.push(`
        (
          u.username LIKE ?
          OR up.full_name LIKE ?
          OR al.event_type LIKE ?
          OR al.entity_type LIKE ?
          OR CAST(al.entity_id AS CHAR) LIKE ?
        )
      `);

      values.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue
      );
    }

    if (eventType) {
      conditions.push('al.event_type = ?');
      values.push(eventType);
    }

    if (entityType) {
      conditions.push('UPPER(al.entity_type) = ?');
      values.push(entityType.toUpperCase());
    }

    if (date) {
      conditions.push('DATE(al.created_at) = ?');
      values.push(date);
    }

    const whereClause = conditions.join(' AND ');

    const [[countResult]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE ${whereClause}
      `,
      values
    );

    const [logs] = await pool.query(
      `
        SELECT
          al.id,
          al.event_type,
          al.entity_type,
          al.entity_id,
          al.before_data,
          al.after_data,
          al.created_at,
          u.id AS actor_user_id,
          u.username AS actor_username,
          up.full_name AS actor_full_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE ${whereClause}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ? OFFSET ?
      `,
      [...values, limit, offset]
    );

    const total = Number(countResult.total);

    return res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    return sendError(res, 500, 'تعذر تحميل سجل التدقيق.');
  }
}

async function getAuditEventTypes(req, res) {
  try {
    const [rows] = await pool.query(
      `
        SELECT DISTINCT event_type
        FROM audit_logs
        WHERE event_type IS NOT NULL
          AND event_type <> ''
        ORDER BY event_type ASC
      `
    );

    return res.json({
      eventTypes: rows.map((row) => row.event_type),
    });
  } catch (error) {
    console.error('Get audit event types error:', error);
    return sendError(res, 500, 'تعذر تحميل أنواع العمليات.');
  }
}

async function getArchivedCourses(req, res) {
  try {
    const page = positiveNumber(req.query.page, 1);
    const limit = Math.min(positiveNumber(req.query.limit, 12), 100);
    const offset = (page - 1) * limit;

    const search = String(req.query.search || '').trim();
    const courseType = String(req.query.courseType || '').trim();
    const status = String(req.query.status || '').trim();
    const year = Number(req.query.year);

    const conditions = [
      `c.deleted_at IS NULL`,
      `c.status IN ('COMPLETED', 'ARCHIVED', 'CANCELLED')`,
    ];

    const values = [];

    if (search) {
      const searchValue = `%${search}%`;

      conditions.push(`
        (
          c.course_no LIKE ?
          OR c.title LIKE ?
          OR c.provider LIKE ?
          OR c.location LIKE ?
        )
      `);

      values.push(searchValue, searchValue, searchValue, searchValue);
    }

    if (courseType === 'TRAINING' || courseType === 'MISSION') {
      conditions.push('c.course_type = ?');
      values.push(courseType);
    }

    if (
      status === 'COMPLETED' ||
      status === 'ARCHIVED' ||
      status === 'CANCELLED'
    ) {
      conditions.push('c.status = ?');
      values.push(status);
    }

    if (Number.isInteger(year) && year > 2000) {
      conditions.push('YEAR(c.start_date) = ?');
      values.push(year);
    }

    const whereClause = conditions.join(' AND ');

    const [[countResult]] = await pool.query(
      `
        SELECT COUNT(*) AS total
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
          c.course_type,
          c.title,
          c.provider,
          c.location,
          c.start_date,
          c.end_date,
          c.total_seats,
          c.status,
          c.created_at,

          COUNT(candidate.id) AS candidates_count,

          SUM(
            candidate.status IN (
              'CONFIRMED',
              'PARTICIPATING',
              'COMPLETED'
            )
          ) AS confirmed_count

        FROM courses c
        LEFT JOIN candidates candidate
          ON candidate.course_id = c.id

        WHERE ${whereClause}

        GROUP BY c.id
        ORDER BY
          COALESCE(c.end_date, c.created_at) DESC,
          c.id DESC

        LIMIT ? OFFSET ?
      `,
      [...values, limit, offset]
    );

    const [years] = await pool.query(
      `
        SELECT DISTINCT YEAR(start_date) AS year
        FROM courses
        WHERE deleted_at IS NULL
          AND start_date IS NOT NULL
          AND status IN ('COMPLETED', 'ARCHIVED', 'CANCELLED')
        ORDER BY year DESC
      `
    );

    const total = Number(countResult.total);

    return res.json({
      courses,
      years: years.map((item) => item.year).filter(Boolean),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Get archived courses error:', error);
    return sendError(res, 500, 'تعذر تحميل أرشيف الدورات والمهام.');
  }
}

module.exports = {
  getAuditLogs,
  getAuditEventTypes,
  getArchivedCourses,
};