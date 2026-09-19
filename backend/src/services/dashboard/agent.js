const pool = require('../../config/database');
const { getAgentSector } = require('../../repositories/assignments.repository');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

async function getDashboard(req, res) {
  try {
    const sector = await getAgentSector(pool, req.user.id);

    if (!sector) {
      return sendError(
        res,
        403,
        'لا يوجد قطاع نشط معيّن لهذا الوكيل.'
      );
    }

    const [
      [employeesRows],
      [coursesRows],
      [pendingRows],
      [unreadRows],
      [recentCourses],
      [recentNotifications],
    ] = await Promise.all([
      pool.execute(
        `
          SELECT COUNT(DISTINCT eda.employee_user_id) AS total
          FROM employee_department_assignments eda
          INNER JOIN departments d
            ON d.id = eda.department_id
          INNER JOIN users u
            ON u.id = eda.employee_user_id
          WHERE d.sector_id = ?
            AND eda.end_date IS NULL
            AND u.is_active = TRUE
            AND u.deleted_at IS NULL
        `,
        [sector.id]
      ),

      pool.execute(
        `
          SELECT COUNT(DISTINCT c.id) AS total
          FROM courses c
          INNER JOIN course_sector_targets cst
            ON cst.course_id = c.id
          WHERE cst.sector_id = ?
            AND c.deleted_at IS NULL
            AND c.status NOT IN (
              'COMPLETED',
              'ARCHIVED',
              'CANCELLED'
            )
        `,
        [sector.id]
      ),

      pool.execute(
        `
          SELECT COUNT(DISTINCT n.id) AS total
          FROM nominations n
          INNER JOIN departments d
            ON d.id = n.department_id
          WHERE d.sector_id = ?
            AND n.status = 'SUBMITTED'
        `,
        [sector.id]
      ),

      pool.execute(
        `
          SELECT COUNT(*) AS total
          FROM notifications
          WHERE recipient_user_id = ?
            AND is_read = FALSE
        `,
        [req.user.id]
      ),

      pool.execute(
        `
          SELECT
            c.id,
            c.course_no,
            c.title,
            c.course_type,
            c.status,
            COUNT(DISTINCT n.id) AS pending_nominations
          FROM courses c
          INNER JOIN course_sector_targets cst
            ON cst.course_id = c.id
            AND cst.sector_id = ?
          LEFT JOIN departments d
            ON d.sector_id = cst.sector_id
          LEFT JOIN nominations n
            ON n.course_id = c.id
            AND n.department_id = d.id
            AND n.status = 'SUBMITTED'
          WHERE c.deleted_at IS NULL
            AND c.status NOT IN (
              'COMPLETED',
              'ARCHIVED',
              'CANCELLED'
            )
          GROUP BY
            c.id,
            c.course_no,
            c.title,
            c.course_type,
            c.status
          ORDER BY c.created_at DESC
          LIMIT 5
        `,
        [sector.id]
      ),

      pool.execute(
        `
          SELECT
            id,
            title,
            message,
            is_read,
            created_at
          FROM notifications
          WHERE recipient_user_id = ?
          ORDER BY is_read ASC, created_at DESC
          LIMIT 5
        `,
        [req.user.id]
      ),
    ]);

    return res.json({
      sector,

      summary: {
        sectorEmployees: Number(employeesRows[0]?.total || 0),
        sectorCourses: Number(coursesRows[0]?.total || 0),
        pendingNominations: Number(pendingRows[0]?.total || 0),
        unreadNotifications: Number(unreadRows[0]?.total || 0),
      },

      recentCourses,
      recentNotifications,
    });
  } catch (error) {
    console.error('Agent dashboard error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل لوحة تحكم الوكيل.'
    );
  }
}

module.exports = {
  getDashboard,
};
