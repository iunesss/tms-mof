const pool = require('../config/database');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

async function getDashboard(req, res) {
  try {
    const [
      [activeCoursesRows],
      [activeCandidatesRows],
      [pendingReviewRows],
      [unreadNotificationsRows],
      [recentCourses],
      [importantNotifications],
    ] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS total
        FROM courses
        WHERE deleted_at IS NULL
          AND status IN (
            'OPEN_FOR_NOMINATION',
            'NOMINATION_CLOSED',
            'CANDIDATE_PROCESSING',
            'ACTIVE'
          )
      `),

      pool.query(`
        SELECT COUNT(*) AS total
        FROM candidates
        WHERE status NOT IN (
          'REJECTED',
          'WITHDRAWN',
          'REMOVED',
          'CANCELLED',
          'COMPLETED'
        )
      `),

      pool.query(`
        SELECT
          (
            SELECT COUNT(*)
            FROM candidate_documents
            WHERE status IN ('SUBMITTED', 'UNDER_REVIEW')
          )
          +
          (
            SELECT COUNT(*)
            FROM candidate_form_submissions
            WHERE status IN ('SUBMITTED', 'UNDER_REVIEW')
          ) AS total
      `),

      pool.query(
        `
          SELECT COUNT(*) AS total
          FROM notifications
          WHERE recipient_user_id = ?
            AND is_read = FALSE
        `,
        [req.user.id]
      ),

      pool.query(`
        SELECT
          id,
          course_no,
          course_type,
          title,
          start_date,
          status
        FROM courses
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
        LIMIT 7
      `),

      pool.query(
        `
          SELECT
            id,
            notification_type,
            title,
            message,
            is_read,
            related_entity_type,
            related_entity_id,
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
      summary: {
        activeCourses: Number(activeCoursesRows[0].total),
        activeCandidates: Number(activeCandidatesRows[0].total),
        pendingReview: Number(pendingReviewRows[0].total),
        unreadNotifications: Number(unreadNotificationsRows[0].total),
      },

      recentCourses,

      importantNotifications,
    });
  } catch (error) {
    console.error('Course manager dashboard error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل بيانات لوحة مدير الدورة.'
    );
  }
}

module.exports = {
  getDashboard,
};