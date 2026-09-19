const setup = require('./admin-setup');
const { ACTIVE_STATUSES, assertCourseTransition } = require('./course-lifecycle');
const { fs, crypto, pool, writeAuditLog, createNotification, getActorId, sendError,
  parseJson, toFileUrl, normalizeOriginalName, toUiStatus, toDatabaseStatus,
  generateCourseNumber, saveUploadedFiles, syncCourseForms,
  syncTargetsAndLimits, sendDepartmentManagerInvitations, createMissionCandidate,
  notifyMissionCandidates } = setup;

/** يحفظ التقرير النهائي وملفه ضمن معاملة الأرشفة نفسها. */
async function saveFinalReport(connection, file, courseId, actorUserId) {
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
  const [storedFile] = await connection.query(
    `INSERT INTO files (storage_key, original_name, mime_type, size_bytes, checksum, uploaded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`courses/${file.filename}`, normalizeOriginalName(file.originalname), file.mimetype,
      file.size, checksum, actorUserId]
  );
  await connection.query(
    `INSERT INTO course_reports (course_id, report_type, file_id, uploaded_by_user_id)
     VALUES (?, 'FINAL_REPORT', ?, ?)`,
    [courseId, storedFile.insertId, actorUserId]
  );
}

/** قراءة الدورات وإنشاؤها وتعديلها؛ عمليات المرشحين مفصولة في admin-candidates.js. */
async function listCourses(req, res) {
  try {
    const { search = '', type = '', status = '' } = req.query;

    const conditions = ['c.deleted_at IS NULL'];
    const values = [];

    if (search) {
      conditions.push('(c.title LIKE ? OR c.course_no LIKE ?)');
      values.push(`%${search}%`, `%${search}%`);
    }

    if (type) {
      conditions.push('c.course_type = ?');
      values.push(type);
    }

    if (status) {
      if (status === 'ACTIVE') {
        conditions.push(`
          c.status IN (
            'OPEN_FOR_NOMINATION',
            'NOMINATION_CLOSED',
            'CANDIDATE_PROCESSING',
            'ACTIVE'
          )
        `);
      } else {
        conditions.push('c.status = ?');
        values.push(status);
      }
    }

    const [courses] = await pool.query(
      `
        SELECT
          c.id,
          c.course_no,
          c.course_type,
          c.title,
          c.description,
          c.start_date,
          c.end_date,
          c.total_seats,
          c.status AS db_status,
          COUNT(candidate.id) AS candidates_count
        FROM courses c
        LEFT JOIN candidates candidate
          ON candidate.course_id = c.id
          AND candidate.status NOT IN (
            'REJECTED',
            'WITHDRAWN',
            'REMOVED',
            'CANCELLED'
          )
        WHERE ${conditions.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `,
      values
    );

    return res.json({
      total: courses.length,
      courses: courses.map((course) => ({
        ...course,
        status: toUiStatus(course.db_status),
      })),
    });
  } catch (error) {
    console.error('List courses error:', error);
    return sendError(res, 500, 'تعذر تحميل الدورات.');
  }
}

async function getOrganizationOptions(req, res) {
  try {
    const [departments] = await pool.query(
      `
        SELECT
          d.id,
          d.name,
          d.code,
          s.id AS sector_id,
          s.name AS sector_name
        FROM departments d
        INNER JOIN sectors s
          ON s.id = d.sector_id
        WHERE d.deleted_at IS NULL
          AND s.deleted_at IS NULL
        ORDER BY s.name, d.name
      `
    );

    return res.json({ departments });
  } catch (error) {
    console.error('Course organization options error:', error);
    return sendError(res, 500, 'تعذر تحميل الأقسام.');
  }
}
async function getEligibleEmployees(req, res) {
  try {
    const departmentId = Number(req.query.departmentId);

    if (!Number.isInteger(departmentId) || departmentId <= 0) {
      return res.status(400).json({
        message: 'معرّف القسم غير صالح.',
      });
    }

    const [employees] = await pool.execute(
      `
        SELECT DISTINCT
          u.id,
          u.username,
          up.full_name,
          up.employee_number
        FROM employee_department_assignments eda
        INNER JOIN users u
          ON u.id = eda.employee_user_id
        INNER JOIN user_profiles up
          ON up.user_id = u.id
        INNER JOIN user_roles ur
          ON ur.user_id = u.id
        INNER JOIN roles r
          ON r.id = ur.role_id
        WHERE eda.department_id = ?
          AND eda.end_date IS NULL
          AND u.is_active = 1
          AND u.deleted_at IS NULL
          AND r.code = 'EMPLOYEE'
        ORDER BY up.full_name ASC
      `,
      [departmentId]
    );

    return res.status(200).json({
      employees,
    });
  } catch (error) {
    console.error('Eligible employees error:', error);

    return res.status(500).json({
      message: 'تعذر تحميل موظفي القسم.',
    });
  }
}

async function createCourse(req, res) {
  const actorUserId = getActorId(req);

  if (!actorUserId) {
    return sendError(res, 401, 'انتهت الجلسة.');
  }

  // normalizeCourseBody وvalidateCourseBody أتما التطبيع والتحقق قبل الوصول هنا.
  const courseData = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const courseNumber = courseData.courseNo || await generateCourseNumber(connection);

    const dbStatus = toDatabaseStatus(
      courseData.courseType,
      courseData.status
    );

    const [courseResult] = await connection.query(
      `
        INSERT INTO courses (
          course_no,
          course_type,
          title,
          description,
          provider,
          location,
          start_date,
          end_date,
          nomination_deadline,
          total_seats,
          status,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        courseNumber,
        courseData.courseType,
        courseData.title,
        courseData.description || null,
        courseData.provider || null,
        courseData.location || null,
        courseData.startDate || null,
        courseData.endDate || null,
        courseData.courseType === 'TRAINING'
          ? courseData.nominationDeadline || null
          : null,
        courseData.totalSeats,
        dbStatus,
        actorUserId,
      ]
    );

    const courseId = courseResult.insertId;

    await connection.query(
      `
        INSERT INTO course_status_history (
          course_id,
          from_status,
          to_status,
          reason,
          changed_by_user_id
        )
        VALUES (?, NULL, ?, ?, ?)
      `,
      [
        courseId,
        dbStatus,
        'إنشاء الدورة أو المهمة.',
        actorUserId,
      ]
    );

    await syncTargetsAndLimits(
      connection,
      courseId,
      courseData.allocations,
      actorUserId
    );

    await saveUploadedFiles(
      connection,
      req.files,
      actorUserId,
      courseId
    );

await syncCourseForms(
  connection,
  req.files,
  courseData.courseForms,
  [],
  actorUserId,
  courseId
);

    if (courseData.courseType === 'MISSION') {
      for (const employeeUserId of courseData.directEmployeeIds || []) {
        await createMissionCandidate(connection, {
          courseId,
          employeeUserId,
          actorUserId,
          courseTitle: courseData.title,
          shouldNotify: dbStatus !== 'DRAFT',
        });
      }
    }

    if (
      courseData.courseType === 'TRAINING' &&
      dbStatus === 'OPEN_FOR_NOMINATION'
    ) {
      await sendDepartmentManagerInvitations(
        connection,
        courseId,
        actorUserId,
        courseData.title
      );
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'COURSE_CREATED',
      entityType: 'COURSE',
      entityId: courseId,
      afterData: {
        course_no: courseNumber,
        course_type: courseData.courseType,
        status: dbStatus,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message: 'تم إنشاء الدورة بنجاح.',
      course: {
        id: courseId,
        courseNo: courseNumber,
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error('Create course error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر إنشاء الدورة.'
    );
  } finally {
    connection.release();
  }
}

async function getCourse(req, res) {
  const { courseId } = req.params;

  try {
    const [[course]] = await pool.query(
      `
        SELECT c.*, c.status AS db_status
        FROM courses c
        WHERE c.id = ?
          AND c.deleted_at IS NULL
      `,
      [courseId]
    );

    if (!course) {
      return sendError(res, 404, 'الدورة غير موجودة.');
    }

    const [allocations] = await pool.query(
      `
        SELECT
          cda.department_id,
          cda.nomination_limit,
          d.name AS department_name,
          s.name AS sector_name,
          COUNT(n.id) AS nominations_count
        FROM course_department_allocations cda
        INNER JOIN departments d
          ON d.id = cda.department_id
        INNER JOIN sectors s
          ON s.id = d.sector_id
        LEFT JOIN nominations n
          ON n.course_id = cda.course_id
          AND n.department_id = cda.department_id
          AND n.status NOT IN ('AGENT_REJECTED', 'WITHDRAWN')
        WHERE cda.course_id = ?
        GROUP BY
          cda.department_id,
          cda.nomination_limit,
          d.name,
          s.name
        ORDER BY s.name, d.name
      `,
      [courseId]
    );

    const [attachments] = await pool.query(
      `
        SELECT
          ca.id,
          ca.attachment_type,
          f.original_name,
          f.storage_key
        FROM course_attachments ca
        INNER JOIN files f
          ON f.id = ca.file_id
        WHERE ca.course_id = ?
          AND ca.deleted_at IS NULL
          AND f.deleted_at IS NULL
        ORDER BY ca.created_at DESC
      `,
      [courseId]
    );
const [courseForms] = await pool.query(
  `
    SELECT
      cf.id,
      cf.title,
      cf.is_required,
      cf.due_at,
      cf.display_order,
      f.original_name,
      f.storage_key
    FROM course_forms cf
    INNER JOIN files f
      ON f.id = cf.template_file_id
    WHERE cf.course_id = ?
      AND cf.deleted_at IS NULL
      AND f.deleted_at IS NULL
    ORDER BY cf.display_order, cf.created_at
  `,
  [courseId]
);
    const [[finalReport]] = await pool.query(
      `SELECT r.id, f.original_name, f.storage_key
       FROM course_reports r JOIN files f ON f.id = r.file_id
       WHERE r.course_id = ? AND r.report_type = 'FINAL_REPORT'
         AND r.deleted_at IS NULL AND f.deleted_at IS NULL
       ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
      [courseId]
    );
    return res.json({
      course: {
        ...course,
        status: toUiStatus(course.db_status),
        allocations: allocations.map((allocation) => ({
          ...allocation,
          remaining_nominations:
            allocation.nomination_limit - allocation.nominations_count,
        })),
        attachments: attachments.map((attachment) => ({
          ...attachment,
          file_url: toFileUrl(attachment.storage_key),
        })),
        forms: courseForms.map((form) => ({
          ...form,
          file_url: toFileUrl(form.storage_key),
        })),
        final_report: finalReport ? {
          id: finalReport.id,
          original_name: finalReport.original_name,
          file_url: toFileUrl(finalReport.storage_key),
        } : null,
      },
    });
  } catch (error) {
    console.error('Get course error:', error);
    return sendError(res, 500, 'تعذر تحميل تفاصيل الدورة.');
  }
}

async function updateCourse(req, res) {
  const actorUserId = getActorId(req);
  const { courseId } = req.params;

  if (!actorUserId) {
    return sendError(res, 401, 'انتهت الجلسة.');
  }

  const courseData = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[existingCourse]] = await connection.query(
      `
        SELECT *
        FROM courses
        WHERE id = ?
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [courseId]
    );

    if (!existingCourse) {
      throw new Error('الدورة غير موجودة.');
    }

    // نبقي مرحلة النشاط الداخلية كما هي عند حفظ البيانات بلا تغيير للحالة.
    const dbStatus = courseData.status === 'ACTIVE' && ACTIVE_STATUSES.has(existingCourse.status)
      ? existingCourse.status
      : toDatabaseStatus(courseData.courseType, courseData.status);
    assertCourseTransition(existingCourse.status, dbStatus);

    const finalReport = req.files?.finalReport?.[0];
    if (dbStatus === 'ARCHIVED') {
      if (!finalReport) throw new Error('ارفع التقرير النهائي قبل أرشفة الدورة.');
      await saveFinalReport(connection, finalReport, Number(courseId), actorUserId);
      await connection.query('UPDATE courses SET status = ? WHERE id = ?', ['ARCHIVED', courseId]);
      await connection.query(
        `INSERT INTO course_status_history
         (course_id, from_status, to_status, reason, changed_by_user_id)
         VALUES (?, ?, 'ARCHIVED', ?, ?)`,
        [courseId, existingCourse.status, 'أُرشفت الدورة بعد رفع التقرير النهائي.', actorUserId]
      );
      await writeAuditLog(connection, {
        actorUserId, eventType: 'COURSE_ARCHIVED', entityType: 'COURSE',
        entityId: Number(courseId),
        beforeData: { status: existingCourse.status },
        afterData: { status: 'ARCHIVED', report: finalReport.filename },
      });
      await connection.commit();
      return res.json({ message: 'تم رفع التقرير النهائي وأرشفة الدورة بنجاح.' });
    }
    if (finalReport) throw new Error('رفع التقرير النهائي متاح عند أرشفة دورة مكتملة فقط.');

    const [[candidateCount]] = await connection.query(
      `
        SELECT COUNT(*) AS total
        FROM candidates
        WHERE course_id = ?
      `,
      [courseId]
    );

    if (
      candidateCount.total > 0 &&
      existingCourse.course_type !== courseData.courseType
    ) {
      throw new Error(
        'لا يمكن تغيير نوع الدورة بعد إضافة مرشحين إليها.'
      );
    }

    for (const allocation of courseData.allocations) {
      const [[nominationsCount]] = await connection.query(
        `
          SELECT COUNT(*) AS total
          FROM nominations
          WHERE course_id = ?
            AND department_id = ?
            AND status NOT IN ('AGENT_REJECTED', 'WITHDRAWN')
        `,
        [courseId, allocation.departmentId]
      );

      if (nominationsCount.total > allocation.nominationLimit) {
        throw new Error(
          'لا يمكن تخفيض حد ترشيحات قسم إلى أقل من ترشيحاته الحالية.'
        );
      }
    }

    await connection.query(
      `
        UPDATE courses
        SET
          course_no = ?,
          course_type = ?,
          title = ?,
          description = ?,
          provider = ?,
          location = ?,
          start_date = ?,
          end_date = ?,
          nomination_deadline = ?,
          total_seats = ?,
          status = ?
        WHERE id = ?
      `,
      [
        courseData.courseNo || existingCourse.course_no,

        courseData.courseType,
        courseData.title,
        courseData.description || null,

        /*
          هذه هي النقطة التي أصلحت الجهة والمكان:
          الواجهة الجديدة ترسل provider و location.
        */
        courseData.provider || null,

        courseData.location || null,

        courseData.startDate || null,
        courseData.endDate || null,

        courseData.courseType === 'TRAINING'
          ? courseData.nominationDeadline || null
          : null,

        courseData.totalSeats,
        dbStatus,
        courseId,
      ]
    );

    await syncTargetsAndLimits(
      connection,
      courseId,
      courseData.allocations,
      actorUserId
    );

    await saveUploadedFiles(
      connection,
      req.files,
      actorUserId,
      courseId
    );

await syncCourseForms(
  connection,
  req.files,
  courseData.courseForms,
  courseData.removedCourseFormIds,
  actorUserId,
  Number(courseId)
);
    /*
      للمهمة فقط:
      الموظفون الذين اختيروا في صفحة التعديل يضافون كمرشحين جدد.
    */
    if (
      courseData.courseType === 'MISSION' &&
      Array.isArray(courseData.directEmployeeIds)
    ) {
      for (const employeeUserId of courseData.directEmployeeIds) {
        await createMissionCandidate(connection, {
          courseId: Number(courseId),
          employeeUserId,
          actorUserId,
          courseTitle: courseData.title,
          shouldNotify: dbStatus !== 'DRAFT',
        });
      }
    }

    /*
      دورة تدريبية:
      عند الانتقال من مسودة إلى مفتوحة للترشيح،
      ترسل الدعوات مباشرة إلى مديري الأقسام.
    */
    if (
      existingCourse.status !== 'OPEN_FOR_NOMINATION' &&
      dbStatus === 'OPEN_FOR_NOMINATION'
    ) {
      await sendDepartmentManagerInvitations(
        connection,
        Number(courseId),
        actorUserId,
        courseData.title
      );
    }

    /*
      مهمة:
      عند تفعيل المهمة بعد أن كانت مسودة، نرسل إشعارات
      للموظفين الذين تم اختيارهم مسبقًا.
    */
    if (
      existingCourse.status === 'DRAFT' &&
      dbStatus === 'CANDIDATE_PROCESSING' &&
      courseData.courseType === 'MISSION'
    ) {
      await notifyMissionCandidates(
        connection,
        Number(courseId),
        actorUserId,
        courseData.title
      );
    }

    if (existingCourse.status !== dbStatus) {
      await connection.query(
        `
          INSERT INTO course_status_history (
            course_id,
            from_status,
            to_status,
            reason,
            changed_by_user_id
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          courseId,
          existingCourse.status,
          dbStatus,
          'تعديل حالة الدورة.',
          actorUserId,
        ]
      );
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'COURSE_UPDATED',
      entityType: 'COURSE',
      entityId: Number(courseId),
      beforeData: {
        title: existingCourse.title,
        provider: existingCourse.provider,
        location: existingCourse.location,
        status: existingCourse.status,
      },
      afterData: {
        title: courseData.title,
        provider: courseData.provider || null,
        location: courseData.location || null,
        status: dbStatus,
      },
    });

    await connection.commit();

    return res.json({
      message: 'تم حفظ تعديلات الدورة بنجاح.',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Update course error:', error);

    // رفع Multer يسبق المعاملة؛ أزل تقريرًا لم يُحفظ بسبب فشل الأرشفة.
    if (req.files?.finalReport?.[0]) {
      await fs.promises.unlink(req.files.finalReport[0].path).catch(() => {});
    }

    return sendError(
      res,
      400,
      error.message || 'تعذر تعديل الدورة.'
    );
  } finally {
    connection.release();
  }
}

const candidateOperations = require('./admin-candidates')({
  fs, crypto, pool, writeAuditLog, createNotification, getActorId, sendError,
  parseJson, toFileUrl, normalizeOriginalName, createMissionCandidate,
});

module.exports = {
  listCourses, getOrganizationOptions, getEligibleEmployees, createCourse, getCourse, updateCourse,
  ...candidateOperations,
};


