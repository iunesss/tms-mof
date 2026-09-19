/** يختار مرشحي المهام مباشرة ويشعرهم عند فتح المهمة. */
module.exports = function createMissionHelpers({ createNotification }) {
async function getMissionEmployee(connection, employeeUserId) {
  const [[employee]] = await connection.query(
    `
      SELECT DISTINCT
        u.id,
        up.full_name,
        up.employee_number,
        up.email,
        up.phone,
        up.job_title,
        eda.department_id,
        d.name AS department_name,
        s.id AS sector_id,
        s.name AS sector_name
      FROM users u
      INNER JOIN user_profiles up
        ON up.user_id = u.id
      INNER JOIN user_roles ur
        ON ur.user_id = u.id
      INNER JOIN roles r
        ON r.id = ur.role_id
        AND r.code = 'EMPLOYEE'
      INNER JOIN employee_department_assignments eda
        ON eda.employee_user_id = u.id
        AND eda.end_date IS NULL
      INNER JOIN departments d
        ON d.id = eda.department_id
      INNER JOIN sectors s
        ON s.id = d.sector_id
      WHERE u.id = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `,
    [employeeUserId]
  );

  return employee;
}

async function createMissionCandidate(
  connection,
  {
    courseId,
    employeeUserId,
    actorUserId,
    courseTitle,
    shouldNotify,
  }
) {
  const employee = await getMissionEmployee(
    connection,
    employeeUserId
  );

  if (!employee) {
    throw new Error(
      'الموظف غير صالح أو ليس لديه دور موظف وتعيين إداري فعال.'
    );
  }

  const [[existingCandidate]] = await connection.query(
    `
      SELECT id
      FROM candidates
      WHERE course_id = ?
        AND employee_user_id = ?
        AND status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
    `,
    [courseId, employeeUserId]
  );

  if (existingCandidate) {
    throw new Error(
      `الموظف ${employee.full_name} مضاف مسبقًا ضمن مرشحي المهمة.`
    );
  }

  const [[departmentLimit]] = await connection.query(
    `
      SELECT nomination_limit
      FROM course_department_allocations
      WHERE course_id = ?
        AND department_id = ?
      FOR UPDATE
    `,
    [courseId, employee.department_id]
  );

  if (!departmentLimit) {
    throw new Error(
      `قسم الموظف ${employee.department_name} غير مضاف ضمن المهمة.`
    );
  }

  const [[currentCandidates]] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM candidates c
      LEFT JOIN candidate_snapshots cs
        ON cs.candidate_id = c.id
      WHERE c.course_id = ?
        AND CAST(
          JSON_UNQUOTE(
            JSON_EXTRACT(cs.organization_snapshot, '$.department_id')
          ) AS UNSIGNED
        ) = ?
        AND c.status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
    `,
    [courseId, employee.department_id]
  );

  if (currentCandidates.total >= departmentLimit.nomination_limit) {
    throw new Error(
      `وصل قسم ${employee.department_name} إلى حد المرشحين المسموح به.`
    );
  }

  const [candidateResult] = await connection.query(
    `
      INSERT INTO candidates (
        course_id,
        employee_user_id,
        source_nomination_id,
        status,
        selected_by_user_id
      )
      VALUES (?, ?, NULL, 'DOCUMENTS_PENDING', ?)
    `,
    [courseId, employeeUserId, actorUserId]
  );

  const candidateId = candidateResult.insertId;

  await connection.query(
    `
      INSERT INTO candidate_snapshots (
        candidate_id,
        profile_snapshot,
        organization_snapshot
      )
      VALUES (?, ?, ?)
    `,
    [
      candidateId,
      JSON.stringify({
        full_name: employee.full_name,
        employee_number: employee.employee_number,
        email: employee.email,
        phone: employee.phone,
        job_title: employee.job_title,
      }),
      JSON.stringify({
        department_id: employee.department_id,
        department_name: employee.department_name,
        sector_id: employee.sector_id,
        sector_name: employee.sector_name,
      }),
    ]
  );

  await connection.query(
    `
      INSERT INTO candidate_status_history (
        candidate_id,
        from_status,
        to_status,
        reason,
        changed_by_user_id
      )
      VALUES (?, NULL, 'DOCUMENTS_PENDING', ?, ?)
    `,
    [
      candidateId,
      'تم اختيار الموظف مباشرة للمهمة.',
      actorUserId,
    ]
  );

  await connection.query(
    `
      INSERT INTO candidate_documents (
        candidate_id,
        document_requirement_id
      )
      SELECT ?, id
      FROM document_requirements
      WHERE course_id = ?
        AND deleted_at IS NULL
    `,
    [candidateId, courseId]
  );

  await connection.query(
    `
      INSERT INTO candidate_form_submissions (
        candidate_id,
        course_form_id
      )
      SELECT ?, id
      FROM course_forms
      WHERE course_id = ?
        AND deleted_at IS NULL
    `,
    [candidateId, courseId]
  );

  if (shouldNotify) {
    await createNotification(connection, {
      recipientUserId: employeeUserId,
      senderUserId: actorUserId,
      notificationType: 'MISSION_CANDIDATE_SELECTED',
      title: 'تم اختيارك لمهمة',
      message: `تم اختيارك للمهمة: ${courseTitle}. يرجى استكمال المستندات والنماذج المطلوبة.`,
      relatedEntityType: 'CANDIDATE',
      relatedEntityId: candidateId,
    });
  }

  return candidateId;
}

async function notifyMissionCandidates(
  connection,
  courseId,
  actorUserId,
  courseTitle
) {
  const [candidates] = await connection.query(
    `
      SELECT id, employee_user_id
      FROM candidates
      WHERE course_id = ?
        AND status = 'DOCUMENTS_PENDING'
    `,
    [courseId]
  );

  for (const candidate of candidates) {
    await createNotification(connection, {
      recipientUserId: candidate.employee_user_id,
      senderUserId: actorUserId,
      notificationType: 'MISSION_CANDIDATE_SELECTED',
      title: 'تم اختيارك لمهمة',
      message: `تم اختيارك للمهمة: ${courseTitle}. يرجى استكمال المستندات والنماذج المطلوبة.`,
      relatedEntityType: 'CANDIDATE',
      relatedEntityId: candidate.id,
    });
  }
}



return { createMissionCandidate, notifyMissionCandidates };
};

