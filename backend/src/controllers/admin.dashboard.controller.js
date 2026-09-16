const pool = require('../config/database');

async function getDashboard(req, res, next) {
  try {
    const [
      [userCounts],
      [courseCounts],
      [activityCounts],
      [roleDistribution],
      [recentAuditLogs],
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_users,
          COALESCE(SUM(is_active = TRUE), 0) AS active_users,
          COALESCE(SUM(is_active = FALSE), 0) AS inactive_users
        FROM users
        WHERE deleted_at IS NULL
      `),

      pool.query(`
        SELECT COUNT(*) AS active_courses
        FROM courses
        WHERE status = 'ACTIVE'
          AND deleted_at IS NULL
      `),

      pool.query(`
        SELECT COUNT(*) AS today_activity
        FROM audit_logs
        WHERE DATE(created_at) = CURDATE()
      `),

      pool.query(`
        SELECT
          r.code AS role_code,
          r.name AS role_name,
          COUNT(DISTINCT u.id) AS total_users
        FROM roles r
        LEFT JOIN user_roles ur ON ur.role_id = r.id
        LEFT JOIN users u
          ON u.id = ur.user_id
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
        GROUP BY r.id, r.code, r.name
        ORDER BY
          FIELD(
            r.code,
            'COURSE_MANAGER',
            'AGENT',
            'DEPARTMENT_MANAGER',
            'EMPLOYEE',
            'SUPER_ADMIN'
          )
      `),

      pool.query(`
        SELECT
          al.id,
          al.event_type,
          al.entity_type,
          al.entity_id,
          al.created_at,
          COALESCE(up.full_name, u.username, 'النظام') AS actor_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        LEFT JOIN user_profiles up ON up.user_id = u.id
        ORDER BY al.created_at DESC
        LIMIT 8
      `),
    ]);

    return res.status(200).json({
      summary: {
        totalUsers: Number(userCounts[0].total_users || 0),
        activeUsers: Number(userCounts[0].active_users || 0),
        inactiveUsers: Number(userCounts[0].inactive_users || 0),
        activeCourses: Number(courseCounts[0].active_courses || 0),
        todayActivity: Number(activityCounts[0].today_activity || 0),
      },
      roleDistribution,
      recentAuditLogs,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDashboard,
};