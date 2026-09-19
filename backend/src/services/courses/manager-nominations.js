/** يرسل ترشيحات القسم إلى الوكيل المعيّن ضمن transaction واحدة. */
module.exports = function createManagerNominations({ pool, writeAuditLog, createNotification, sendError, ensureCourseInManagerDepartment }) {
async function submitNominations(req, res) {
  const courseId = Number(req.params.courseId);
  const { employeeUserIds } = req.body;

  if (!Number.isInteger(courseId) || courseId <= 0) {
    return sendError(res, 400, 'معرّف الدورة غير صالح.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      department,
      course,
    } = await ensureCourseInManagerDepartment(
      connection,
      courseId,
      req.user.id
    );

    /*
      المهمة لا يمكن لمدير القسم ترشيح موظفين فيها.
      مدير الدورة هو من يختار المرشحين مباشرة.
    */
    if (course.course_type !== 'TRAINING') {
      throw new Error(
        'الترشيح من مدير القسم متاح للدورات التدريبية فقط.'
      );
    }

    if (course.status !== 'OPEN_FOR_NOMINATION') {
      throw new Error(
        'هذه الدورة غير مفتوحة للترشيح حاليًا.'
      );
    }

    const [[existingSubmission]] = await connection.execute(
      `
        SELECT id
        FROM nominations
        WHERE course_id = ?
          AND department_id = ?
          AND nominated_by_user_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [
        courseId,
        department.id,
        req.user.id,
      ]
    );

    if (existingSubmission) {
      throw new Error(
        'تم إرسال ترشيحات القسم مسبقًا، ولا يمكن تعديلها الآن.'
      );
    }

    if (employeeUserIds.length > Number(course.nomination_limit)) {
      throw new Error(
        `لا يمكن تجاوز حد ترشيحات القسم: ${course.nomination_limit}.`
      );
    }

    const [agentRows] = await connection.execute(
      `
        SELECT
          saa.agent_user_id
        FROM department_manager_assignments dma
        INNER JOIN sector_agent_assignments saa
          ON saa.id = dma.agent_assignment_id
          AND saa.end_date IS NULL
        INNER JOIN users agent_user
          ON agent_user.id = saa.agent_user_id
        WHERE dma.manager_user_id = ?
          AND dma.department_id = ?
          AND dma.end_date IS NULL
          AND agent_user.is_active = TRUE
          AND agent_user.deleted_at IS NULL
        LIMIT 1
      `,
      [
        req.user.id,
        department.id,
      ]
    );

    if (!agentRows.length) {
      throw new Error(
        'لا يوجد وكيل قطاع نشط مرتبط بهذا القسم.'
      );
    }

    const agentUserId = agentRows[0].agent_user_id;

    /*
      المسموح بترشيحهم:
      1. موظفو القسم النشطون.
      2. مدير القسم الحالي نفسه، حتى لو لم يكن لديه دور EMPLOYEE.
    */
    const employeePlaceholders = employeeUserIds
      .map(() => '?')
      .join(', ');

    const [permittedRows] = await connection.execute(
      `
        SELECT DISTINCT permitted_users.id
        FROM (
          SELECT eda.employee_user_id AS id
          FROM employee_department_assignments eda
          INNER JOIN users employee_user
            ON employee_user.id = eda.employee_user_id
          WHERE eda.department_id = ?
            AND eda.end_date IS NULL
            AND employee_user.is_active = TRUE
            AND employee_user.deleted_at IS NULL

          UNION

          SELECT ? AS id
        ) permitted_users
        INNER JOIN users user_account
          ON user_account.id = permitted_users.id
        WHERE user_account.is_active = TRUE
          AND user_account.deleted_at IS NULL
          AND permitted_users.id IN (${employeePlaceholders})
      `,
      [
        department.id,
        req.user.id,
        ...employeeUserIds,
      ]
    );

    if (permittedRows.length !== employeeUserIds.length) {
      throw new Error(
        'يوجد موظف غير تابع للقسم أو حسابه غير نشط.'
      );
    }

    for (const employeeUserId of employeeUserIds) {
      await connection.execute(
        `
          INSERT INTO nominations (
            course_id,
            nominee_user_id,
            department_id,
            nominated_by_user_id,
            agent_user_id,
            status
          )
VALUES (?, ?, ?, ?, ?, 'SUBMITTED')        `,
        [
          courseId,
          employeeUserId,
          department.id,
          req.user.id,
          agentUserId,
        ]
      );
    }

    await createNotification(connection, {
      recipientUserId: agentUserId,
      senderUserId: req.user.id,
      notificationType: 'DEPARTMENT_NOMINATIONS_SUBMITTED',
      title: 'ترشيحات جديدة تحتاج مراجعة',
      message: `أرسل مدير قسم "${department.name}" ${employeeUserIds.length} ترشيحًا للدورة: ${course.title}.`,
      relatedEntityType: 'COURSE',
      relatedEntityId: courseId,
    });

    await writeAuditLog(connection, {
      actorUserId: req.user.id,
      eventType: 'DEPARTMENT_NOMINATIONS_SUBMITTED',
      entityType: 'COURSE',
      entityId: courseId,
      afterData: {
        department_id: department.id,
        nominated_employee_ids: employeeUserIds,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message:
        'تم إرسال ترشيحات القسم إلى وكيل القطاع للمراجعة.',
    });
  } catch (error) {
    await connection.rollback();

    console.error('Manager submit nominations error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(
        res,
        400,
        'يوجد موظف تم ترشيحه مسبقًا لهذه الدورة.'
      );
    }

    return sendError(
      res,
      400,
      error.message || 'تعذر إرسال الترشيحات.'
    );
  } finally {
    connection.release();
  }
}


return { submitNominations };
};

