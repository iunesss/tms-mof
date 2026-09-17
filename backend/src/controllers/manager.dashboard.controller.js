const pool = require('../config/database');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

/*
  يجلب القسم والقطاع الحاليين لمدير القسم.
  كل صفحات المدير القادمة ستستخدم هذه الدالة نفسها
  لمنع رؤية بيانات قسم آخر.
*/
async function getManagerDepartment(connection, managerUserId) {
  const [rows] = await connection.execute(
    `
      SELECT
        d.id,
        d.name,
        d.code,
        s.id AS sector_id,
        s.name AS sector_name
      FROM department_manager_assignments dma
      INNER JOIN departments d
        ON d.id = dma.department_id
      INNER JOIN sectors s
        ON s.id = d.sector_id
      WHERE dma.manager_user_id = ?
        AND dma.end_date IS NULL
        AND d.deleted_at IS NULL
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [managerUserId]
  );

  return rows[0] || null;
}

async function getDashboard(req, res) {
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

    const [
      [employeesRows],
      [coursesRows],
      [pendingRows],
      [unreadRows],
      [recentCourses],
      [recentNotifications],
    ] = await Promise.all([
      /*
        موظفو القسم النشطون فقط.
      */
      pool.execute(
        `
          SELECT COUNT(DISTINCT eda.employee_user_id) AS total
          FROM employee_department_assignments eda
          INNER JOIN users u
            ON u.id = eda.employee_user_id
          WHERE eda.department_id = ?
            AND eda.end_date IS NULL
            AND u.is_active = TRUE
            AND u.deleted_at IS NULL
        `,
        [department.id]
      ),

      /*
        الدورات التي يوجد لها توزيع مقاعد للقسم.
      */
      pool.execute(
        `
          SELECT COUNT(DISTINCT c.id) AS total
          FROM courses c
          INNER JOIN course_department_allocations cda
            ON cda.course_id = c.id
          WHERE cda.department_id = ?
            AND c.deleted_at IS NULL
            AND c.status NOT IN (
              'COMPLETED',
              'ARCHIVED',
              'CANCELLED'
            )
        `,
        [department.id]
      ),

      /*
        الترشيحات التي رفعها مدير القسم للوكيل
        ولم يتخذ الوكيل قرارًا عليها بعد.
      */
      pool.execute(
        `
          SELECT COUNT(*) AS total
          FROM nominations n
          WHERE n.department_id = ?
            AND n.nominated_by_user_id = ?
            AND n.agent_decided_by_user_id IS NULL
            AND n.status NOT IN (
              'AGENT_REJECTED',
              'WITHDRAWN'
            )
        `,
        [department.id, req.user.id]
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

      /*
        آخر الدورات المفتوحة والمتاحة للقسم.
      */
      pool.execute(
        `
          SELECT
            c.id,
            c.course_no,
            c.title,
            c.course_type,
            c.status,

            COUNT(
              DISTINCT CASE
                WHEN n.nominated_by_user_id = ?
                THEN n.id
              END
            ) AS department_nominations_count

          FROM courses c
          INNER JOIN course_department_allocations cda
            ON cda.course_id = c.id
            AND cda.department_id = ?

          LEFT JOIN nominations n
            ON n.course_id = c.id
            AND n.department_id = cda.department_id
            AND n.status NOT IN ('WITHDRAWN')

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
        [req.user.id, department.id]
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
      department,

      summary: {
        departmentEmployees: Number(employeesRows[0]?.total || 0),
        invitedCourses: Number(coursesRows[0]?.total || 0),
        pendingNominations: Number(pendingRows[0]?.total || 0),
        unreadNotifications: Number(unreadRows[0]?.total || 0),
      },

      recentCourses,
      recentNotifications,
    });
  } catch (error) {
    console.error('Manager dashboard error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل لوحة تحكم مدير القسم.'
    );
  }
}

module.exports = {
  getDashboard,
  getManagerDepartment,
};