const fs = require('fs');
const crypto = require('crypto');

const pool = require('../../config/database');
const { writeAuditLog } = require('../../utils/audit');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function toFileUrl(storageKey) {
  const baseUrl =
    process.env.API_PUBLIC_URL || 'http://localhost:3000';

  return `${baseUrl}/uploads/${storageKey}`;
}

function normalizeOriginalName(fileName = '') {
  if (/[\u00C0-\u00FF]/.test(fileName)) {
    const decoded = Buffer.from(fileName, 'latin1').toString('utf8');

    if (!decoded.includes('\uFFFD')) {
      return decoded;
    }
  }

  return fileName;
}

async function getEmployeeCandidate(
  connection,
  courseId,
  employeeUserId,
  includeArchived = false
) {
const courseStatusCondition = includeArchived
  ? `c.status != 'CANCELLED'`
  : `c.status NOT IN ('COMPLETED', 'ARCHIVED', 'CANCELLED')`;

  const [[candidate]] = await connection.query(
    `
      SELECT
        candidate.id AS candidate_id,
        candidate.course_id,
        candidate.employee_user_id,
        candidate.status AS candidate_status,
        candidate.selected_at,
        candidate.confirmed_at,

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
        c.status AS course_status

      FROM candidates candidate
      INNER JOIN courses c
        ON c.id = candidate.course_id

      WHERE candidate.course_id = ?
        AND candidate.employee_user_id = ?
        AND candidate.status NOT IN (
          'REJECTED',
          'WITHDRAWN',
          'REMOVED',
          'CANCELLED'
        )
        AND c.deleted_at IS NULL
        AND ${courseStatusCondition}

      LIMIT 1
    `,
    [courseId, employeeUserId]
  );

  return candidate || null;
}

async function listCourses(req, res, next) {
  try {
    const employeeUserId = req.user.id;

    const [courses] = await pool.query(
      `
        SELECT
          candidate.id AS candidate_id,
          candidate.status AS candidate_status,
          candidate.selected_at,
          candidate.confirmed_at,

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
          c.status

        FROM candidates candidate
        INNER JOIN courses c
          ON c.id = candidate.course_id

        WHERE candidate.employee_user_id = ?
          AND candidate.status NOT IN (
            'REJECTED',
            'WITHDRAWN',
            'REMOVED',
            'CANCELLED'
          )
          AND c.deleted_at IS NULL
          AND c.status NOT IN (
            'COMPLETED',
            'ARCHIVED',
            'CANCELLED'
          )

        ORDER BY
          c.start_date ASC,
          c.created_at DESC
      `,
      [employeeUserId]
    );

    const [[unreadResult]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM notifications
        WHERE recipient_user_id = ?
          AND is_read = FALSE
      `,
      [employeeUserId]
    );

    return res.status(200).json({
      courses,
      unreadCount: Number(unreadResult.total || 0),
    });
  } catch (error) {
    next(error);
  }
}

async function getArchive(req, res, next) {
  try {
    const employeeUserId = req.user.id;

    const [courses] = await pool.query(
      `
        SELECT
          candidate.id AS candidate_id,
          candidate.status AS candidate_status,
          candidate.selected_at,
          candidate.confirmed_at,

          c.id,
          c.course_no,
          c.course_type,
          c.title,
          c.description,
          c.provider,
          c.location,
          c.start_date,
          c.end_date,
          c.status

        FROM candidates candidate
        INNER JOIN courses c
          ON c.id = candidate.course_id

        WHERE candidate.employee_user_id = ?
          AND candidate.status NOT IN (
            'REJECTED',
            'WITHDRAWN',
            'REMOVED',
            'CANCELLED'
          )
          AND c.deleted_at IS NULL
          AND c.status IN ('COMPLETED', 'ARCHIVED')

        ORDER BY
          COALESCE(c.end_date, c.start_date) DESC,
          c.created_at DESC
      `,
      [employeeUserId]
    );

    return res.status(200).json({
      courses,
    });
  } catch (error) {
    next(error);
  }
}

async function getCourse(req, res, next) {
  try {
    const courseId = Number(req.params.courseId);

    if (!Number.isInteger(courseId) || courseId <= 0) {
      return sendError(res, 400, 'معرّف الدورة غير صالح.');
    }

    const employeeUserId = req.user.id;

    /*
      يسمح بعرض الدورة الحالية أو الدورة المؤرشفة،
      بشرط أن يكون الموظف مرشحًا فيها فعلًا.
    */
    const candidate = await getEmployeeCandidate(
      pool,
      courseId,
      employeeUserId,
      true
    );

    if (!candidate) {
      return sendError(
        res,
        404,
        'الدورة غير موجودة أو لا تملك صلاحية عرضها.'
      );
    }

    const [
      attachmentsResult,
      formsResult,
      candidateAttachmentsResult,
    ] = await Promise.all([
      pool.query(
        `
          SELECT
            ca.id,
            ca.attachment_type,
            ca.created_at,
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
      ),

      pool.query(
        `
          SELECT
            cf.id,
            cf.title,
            cf.is_required,
            cf.due_at,
            cf.display_order,

            template_file.storage_key AS template_storage_key,
            template_file.original_name AS template_original_name,

            cfs.id AS submission_id,
            cfs.status AS submission_status,
            cfs.current_version_no,
            cfs.last_submitted_at,

            latest_version.file_id AS submitted_file_id,
            latest_file.storage_key AS submitted_storage_key,
            latest_file.original_name AS submitted_original_name

          FROM course_forms cf
          INNER JOIN files template_file
            ON template_file.id = cf.template_file_id

          LEFT JOIN candidate_form_submissions cfs
            ON cfs.course_form_id = cf.id
            AND cfs.candidate_id = ?

          LEFT JOIN form_submission_versions latest_version
            ON latest_version.candidate_form_submission_id = cfs.id
            AND latest_version.version_no = cfs.current_version_no

          LEFT JOIN files latest_file
            ON latest_file.id = latest_version.file_id

          WHERE cf.course_id = ?
            AND cf.deleted_at IS NULL
            AND template_file.deleted_at IS NULL

          ORDER BY
            cf.display_order ASC,
            cf.created_at ASC
        `,
        [candidate.candidate_id, courseId]
      ),

      // التذكرة والتأشيرة وغيرها تُرفع للمرشح نفسه وليست مرفقات عامة للدورة.
      pool.query(
        `
          SELECT ca.id, ca.attachment_type, ca.note, ca.created_at,
                 f.original_name, f.storage_key
          FROM candidate_attachments ca
          INNER JOIN files f ON f.id = ca.file_id
          WHERE ca.candidate_id = ?
            AND ca.deleted_at IS NULL
            AND f.deleted_at IS NULL
          ORDER BY ca.created_at DESC
        `,
        [candidate.candidate_id]
      ),
    ]);

    const [attachments] = attachmentsResult;
    const [forms] = formsResult;
    const [candidateAttachments] = candidateAttachmentsResult;

    return res.status(200).json({
      course: {
        id: candidate.course_id,
        course_no: candidate.course_no,
        course_type: candidate.course_type,
        title: candidate.title,
        description: candidate.description,
        provider: candidate.provider,
        location: candidate.location,
        start_date: candidate.start_date,
        end_date: candidate.end_date,
        nomination_deadline: candidate.nomination_deadline,
        total_seats: candidate.total_seats,
        status: candidate.course_status,
      },

      candidate: {
        id: candidate.candidate_id,
        status: candidate.candidate_status,
        selected_at: candidate.selected_at,
        confirmed_at: candidate.confirmed_at,
      },

      attachments: attachments.map((attachment) => ({
        ...attachment,
        file_url: toFileUrl(attachment.storage_key),
      })),

      candidateAttachments: candidateAttachments.map((attachment) => ({
        ...attachment,
        file_url: toFileUrl(attachment.storage_key),
      })),

      forms: forms.map((form) => ({
        ...form,
        template_file_url: toFileUrl(form.template_storage_key),
        submitted_file_url: form.submitted_storage_key
          ? toFileUrl(form.submitted_storage_key)
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function submitForm(req, res) {
  const connection = await pool.getConnection();

  try {
    const courseId = Number(req.params.courseId);
    const formId = Number(req.params.formId);
    const employeeUserId = req.user.id;

    if (
      !Number.isInteger(courseId) ||
      courseId <= 0 ||
      !Number.isInteger(formId) ||
      formId <= 0
    ) {
      return sendError(res, 400, 'معرّف الدورة أو الاستمارة غير صالح.');
    }

    if (!req.file) {
      return sendError(res, 400, 'يرجى اختيار ملف الاستمارة.');
    }

    await connection.beginTransaction();

    const candidate = await getEmployeeCandidate(
      connection,
      courseId,
      employeeUserId,
      false
    );

    if (!candidate) {
      throw new Error(
        'لا تملك صلاحية رفع استمارة لهذه الدورة أو أنها ليست دورة حالية.'
      );
    }

    const [[courseForm]] = await connection.query(
      `
        SELECT
          id,
          title,
          is_required
        FROM course_forms
        WHERE id = ?
          AND course_id = ?
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [formId, courseId]
    );

    if (!courseForm) {
      throw new Error('الاستمارة غير موجودة ضمن هذه الدورة.');
    }

    const [[submission]] = await connection.query(
      `
        SELECT
          id,
          status,
          current_version_no
        FROM candidate_form_submissions
        WHERE candidate_id = ?
          AND course_form_id = ?
        FOR UPDATE
      `,
      [candidate.candidate_id, formId]
    );

    let submissionId;
    let previousStatus = 'PENDING';
    let currentVersionNo = 0;

    if (submission) {
      submissionId = submission.id;
      previousStatus = submission.status;
      currentVersionNo = Number(submission.current_version_no || 0);

      if (previousStatus === 'APPROVED') {
        throw new Error(
          'تم اعتماد هذه الاستمارة بالفعل، ولا يمكن استبدالها.'
        );
      }
    } else {
      const [submissionResult] = await connection.query(
        `
          INSERT INTO candidate_form_submissions (
            candidate_id,
            course_form_id,
            status,
            current_version_no
          )
          VALUES (?, ?, 'PENDING', 0)
        `,
        [candidate.candidate_id, formId]
      );

      submissionId = submissionResult.insertId;
    }

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(req.file.path))
      .digest('hex');

    const storageKey = `forms/${req.file.filename}`;
    const originalName = normalizeOriginalName(req.file.originalname);

    const [fileResult] = await connection.query(
      `
        INSERT INTO files (
          storage_key,
          original_name,
          mime_type,
          size_bytes,
          checksum,
          uploaded_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        storageKey,
        originalName,
        req.file.mimetype,
        req.file.size,
        checksum,
        employeeUserId,
      ]
    );

    const nextVersionNo = currentVersionNo + 1;

    await connection.query(
      `
        INSERT INTO form_submission_versions (
          candidate_form_submission_id,
          version_no,
          file_id,
          uploaded_by_user_id
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        submissionId,
        nextVersionNo,
        fileResult.insertId,
        employeeUserId,
      ]
    );

    const nextStatus = previousStatus === 'REJECTED'
      ? 'RESUBMITTED'
      : 'SUBMITTED';

    await connection.query(
      `
        UPDATE candidate_form_submissions
        SET
          status = ?,
          current_version_no = ?,
          last_submitted_at = NOW()
        WHERE id = ?
      `,
      [
        nextStatus,
        nextVersionNo,
        submissionId,
      ]
    );

    await writeAuditLog(connection, {
      actorUserId: employeeUserId,
      eventType: 'CANDIDATE_FORM_SUBMITTED',
      entityType: 'CANDIDATE_FORM_SUBMISSION',
      entityId: submissionId,
      afterData: {
        course_id: courseId,
        course_form_id: formId,
        candidate_id: candidate.candidate_id,
        version_no: nextVersionNo,
        status: nextStatus,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message: previousStatus === 'REJECTED'
        ? 'تم رفع نسخة جديدة من الاستمارة بنجاح.'
        : 'تم رفع الاستمارة بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    console.error('Employee form submission error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر رفع الاستمارة.'
    );
  } finally {
    connection.release();
  }
}

module.exports = {
  listCourses,
  getArchive,
  getCourse,
  submitForm,
};
