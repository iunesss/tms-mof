const pool = require('../config/database');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

/*
  يجلب بيانات الموظف الأساسية والقسم الحالي.

  الموظف يرى فقط بياناته هو، لذلك نعتمد دائمًا
  على req.user.id القادم من authenticate.
*/
async function getEmployeeInfo(connection, employeeUserId) {
  const [rows] = await connection.execute(
    `
      SELECT
        u.id AS user_id,
        u.username,
        u.is_active,

        up.full_name,
        up.employee_number,
        up.email,
        up.phone,
        up.job_title,
        up.rank_name,
        up.employment_type,
        up.gender,
        up.date_of_birth,
        up.nationality,
        up.passport_number,
        up.passport_expiry_date,

        d.id AS department_id,
        d.name AS department_name,
        d.code AS department_code

      FROM users u

      LEFT JOIN user_profiles up
        ON up.user_id = u.id

      LEFT JOIN employee_department_assignments eda
        ON eda.employee_user_id = u.id
        AND eda.end_date IS NULL

      LEFT JOIN departments d
        ON d.id = eda.department_id
        AND d.deleted_at IS NULL

      WHERE u.id = ?
        AND u.deleted_at IS NULL

      LIMIT 1
    `,
    [employeeUserId]
  );

  return rows[0] || null;
}

/*
  لوحة تحكم الموظف.
*/
async function getDashboard(req, res) {
  try {
    const employeeUserId = req.user.id;

    const employee = await getEmployeeInfo(
      pool,
      employeeUserId
    );

    if (!employee) {
      return sendError(
        res,
        404,
        'لم يتم العثور على بيانات الموظف.'
      );
    }

    /*
      الدورة الحالية:

      لا تظهر للموظف إلا عندما يصبح ترشيحه
      CONVERTED_TO_CANDIDATE.

      نربط nomination بالموظف نفسه.
    */
    const [
      [currentCourseRows],
      [previousCourseRows],
      [unreadRows],
      [recentNotifications],
    ] = await Promise.all([
      pool.execute(
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

            n.id AS nomination_id,
            n.status AS nomination_status,
            n.submitted_at,
            n.agent_decided_at

          FROM nominations n

          INNER JOIN courses c
            ON c.id = n.course_id

          WHERE n.nominee_user_id = ?
            AND n.status = 'CONVERTED_TO_CANDIDATE'
            AND c.deleted_at IS NULL
            AND c.status NOT IN (
              'COMPLETED',
              'ARCHIVED',
              'CANCELLED'
            )

          ORDER BY
            c.start_date ASC,
            c.created_at DESC

          LIMIT 1
        `,
        [employeeUserId]
      ),

      /*
        سجل الدورات السابقة.

        تظهر الدورة إذا كانت:
        COMPLETED أو ARCHIVED.

        ويجب أن يكون الموظف Candidate فيها،
        حتى لا تظهر للموظف دورات لا تخصه.
      */
      pool.execute(
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
            c.status,

            n.id AS nomination_id,
            n.status AS nomination_status

          FROM nominations n

          INNER JOIN courses c
            ON c.id = n.course_id

          WHERE n.nominee_user_id = ?
            AND n.status = 'CONVERTED_TO_CANDIDATE'
            AND c.deleted_at IS NULL
            AND c.status IN (
              'COMPLETED',
              'ARCHIVED'
            )

          ORDER BY
            COALESCE(c.end_date, c.start_date) DESC,
            c.created_at DESC

          LIMIT 10
        `,
        [employeeUserId]
      ),

      /*
        عدد الإشعارات غير المقروءة الخاصة بالموظف.
      */
      pool.execute(
        `
          SELECT COUNT(*) AS total
          FROM notifications
          WHERE recipient_user_id = ?
            AND is_read = FALSE
        `,
        [employeeUserId]
      ),

      /*
        آخر إشعارات الموظف.
      */
      pool.execute(
        `
          SELECT
            id,
            sender_user_id,
            notification_type,
            title,
            message,
            related_entity_type,
            related_entity_id,
            is_read,
            read_at,
            created_at

          FROM notifications

          WHERE recipient_user_id = ?

          ORDER BY
            is_read ASC,
            created_at DESC

          LIMIT 5
        `,
        [employeeUserId]
      ),
    ]);

    return res.json({
      employee: {
        id: employee.user_id,
        username: employee.username,
        isActive: Boolean(employee.is_active),

        fullName: employee.full_name,
        employeeNumber: employee.employee_number,
        email: employee.email,
        phone: employee.phone,
        jobTitle: employee.job_title,
        rankName: employee.rank_name,
        employmentType: employee.employment_type,
        gender: employee.gender,
        dateOfBirth: employee.date_of_birth,
        nationality: employee.nationality,
        passportNumber: employee.passport_number,
        passportExpiryDate: employee.passport_expiry_date,

        department: employee.department_id
          ? {
              id: employee.department_id,
              name: employee.department_name,
              code: employee.department_code,
            }
          : null,
      },

      summary: {
        hasCurrentCourse: currentCourseRows.length > 0,
        previousCourses: previousCourseRows.length,
        unreadNotifications: Number(
          unreadRows[0]?.total || 0
        ),
      },

      currentCourse: currentCourseRows[0] || null,

      previousCourses: previousCourseRows,

      recentNotifications,
    });
  } catch (error) {
    console.error(
      'Employee dashboard error:',
      error
    );

    return sendError(
      res,
      500,
      'تعذر تحميل لوحة تحكم الموظف.'
    );
  }
}

module.exports = {
  getDashboard,
  getEmployeeInfo,
};