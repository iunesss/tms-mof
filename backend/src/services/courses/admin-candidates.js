/** اختيار المرشحين وحالاتهم؛ تستقبل الاعتمادات المشتركة من خدمة إدارة الدورات. */
module.exports = function createCandidateOperations({
  fs, crypto, pool, writeAuditLog, createNotification, getActorId, sendError,
  parseJson, toFileUrl, normalizeOriginalName, createMissionCandidate,
}) {
async function listCourseCandidates(req, res) {
  const { courseId } = req.params;

  try {
    const [candidates] = await pool.query(
      `
        SELECT
          c.id,
          c.status,
          c.selected_at,
          up.full_name,
          up.employee_number,
          COALESCE(
            d.name,
            JSON_UNQUOTE(
              JSON_EXTRACT(cs.organization_snapshot, '$.department_name')
            )
          ) AS department_name,
          COALESCE(
            s.name,
            JSON_UNQUOTE(
              JSON_EXTRACT(cs.organization_snapshot, '$.sector_name')
            )
          ) AS sector_name
        FROM candidates c
        INNER JOIN user_profiles up
          ON up.user_id = c.employee_user_id
        LEFT JOIN nominations n
          ON n.id = c.source_nomination_id
        LEFT JOIN departments d
          ON d.id = n.department_id
        LEFT JOIN sectors s
          ON s.id = d.sector_id
        LEFT JOIN candidate_snapshots cs
          ON cs.candidate_id = c.id
        WHERE c.course_id = ?
        ORDER BY c.selected_at DESC
      `,
      [courseId]
    );
const [approvedNominations] = await pool.query(
  `
    SELECT
      n.id,
      n.created_at,
      up.full_name,
      up.employee_number,
      d.name AS department_name,
      s.name AS sector_name
    FROM nominations n
    INNER JOIN user_profiles up
      ON up.user_id = n.nominee_user_id
    INNER JOIN departments d
      ON d.id = n.department_id
    INNER JOIN sectors s
      ON s.id = d.sector_id
    LEFT JOIN candidates candidate
      ON candidate.source_nomination_id = n.id
    WHERE n.course_id = ?
      AND n.status = 'AGENT_CONFIRMED'
      AND candidate.id IS NULL
    ORDER BY s.name, d.name, n.created_at
  `,
  [courseId]
);
return res.json({ candidates, approvedNominations });  } catch (error) {
    console.error('List course candidates error:', error);
    return sendError(res, 500, 'تعذر تحميل المرشحين.');
  }
}

async function addDirectCandidate(req, res) {
  const actorUserId = getActorId(req);
  const { courseId } = req.params;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[course]] = await connection.query(
      `
        SELECT *
        FROM courses
        WHERE id = ?
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [courseId]
    );

    if (!course || course.course_type !== 'MISSION') {
      throw new Error('الإضافة المباشرة للموظفين متاحة للمهمة فقط.');
    }

    const candidateId = await createMissionCandidate(connection, {
      courseId: Number(courseId),
      employeeUserId: req.body.employeeUserId,
      actorUserId,
      courseTitle: course.title,
      shouldNotify: course.status !== 'DRAFT',
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'MISSION_CANDIDATE_ADDED',
      entityType: 'CANDIDATE',
      entityId: candidateId,
    });

    await connection.commit();

    return res.status(201).json({
      message: 'تمت إضافة الموظف كمرشح للمهمة.',
      candidate: { id: candidateId },
    });
  } catch (error) {
    await connection.rollback();
    console.error('Direct candidate error:', error);

    return sendError(res, 400, error.message || 'تعذر إضافة المرشح.');
  } finally {
    connection.release();
  }
}

async function getCandidate(req, res) {
  const { courseId, candidateId } = req.params;

  try {
    const [[candidate]] = await pool.query(
      `
        SELECT
          c.*,
          co.title AS course_title,
          up.full_name,
          up.employee_number,
          cs.profile_snapshot,
          cs.organization_snapshot
        FROM candidates c
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN user_profiles up
          ON up.user_id = c.employee_user_id
        LEFT JOIN candidate_snapshots cs
          ON cs.candidate_id = c.id
        WHERE c.id = ?
          AND c.course_id = ?
      `,
      [candidateId, courseId]
    );

    if (!candidate) {
      return sendError(res, 404, 'المرشح غير موجود ضمن هذه الدورة.');
    }

    const [
      formsResult,
      profileDocumentsResult,
      attachmentsResult,
      statusHistoryResult,
    ] = await Promise.all([
      pool.query(
        `
          SELECT
            cfs.id,
            cf.title,
            cf.is_required,
            cfs.status,
            cfs.current_version_no,
            cfs.last_submitted_at,
            cfs.reviewed_at,
            cfs.rejection_reason,

            f.original_name,
            f.storage_key

          FROM candidate_form_submissions cfs
          INNER JOIN course_forms cf
            ON cf.id = cfs.course_form_id

          LEFT JOIN form_submission_versions fsv
            ON fsv.candidate_form_submission_id = cfs.id
            AND fsv.version_no = cfs.current_version_no

          LEFT JOIN files f
            ON f.id = fsv.file_id

          WHERE cfs.candidate_id = ?

          ORDER BY
            cf.display_order ASC,
            cf.title ASC
        `,
        [candidateId]
      ),

      pool.query(
        `
          SELECT
            pd.id,
            pd.document_type,
            pd.label,
            pd.status,

            latest_review.rejection_reason,
            latest_review.reviewed_at,

            f.original_name,
            f.storage_key

          FROM profile_documents pd

          LEFT JOIN profile_document_versions pdv
            ON pdv.profile_document_id = pd.id
            AND pdv.version_no = (
              SELECT MAX(version_no)
              FROM profile_document_versions
              WHERE profile_document_id = pd.id
            )

          LEFT JOIN files f
            ON f.id = pdv.file_id

          LEFT JOIN profile_document_reviews latest_review
            ON latest_review.id = (
              SELECT MAX(review2.id)
              FROM profile_document_reviews review2
              WHERE review2.profile_document_version_id = pdv.id
            )

          WHERE pd.user_profile_id = ?
            AND pd.deleted_at IS NULL

          ORDER BY pd.created_at DESC
        `,
        [candidate.employee_user_id]
      ),

      pool.query(
        `
          SELECT
            ca.id,
            ca.attachment_type,
            ca.note,
            ca.created_at,

            f.original_name,
            f.storage_key

          FROM candidate_attachments ca
          INNER JOIN files f
            ON f.id = ca.file_id

          WHERE ca.candidate_id = ?
            AND ca.deleted_at IS NULL

          ORDER BY ca.created_at DESC
        `,
        [candidateId]
      ),

      pool.query(
        `
          SELECT
            from_status,
            to_status,
            reason,
            changed_at
          FROM candidate_status_history
          WHERE candidate_id = ?
          ORDER BY changed_at DESC
        `,
        [candidateId]
      ),
    ]);

    const [forms] = formsResult;
    const [profileDocuments] = profileDocumentsResult;
    const [attachments] = attachmentsResult;
    const [statusHistory] = statusHistoryResult;

    return res.json({
      candidate: {
        ...candidate,

        snapshot: {
          ...parseJson(candidate.profile_snapshot),
          ...parseJson(candidate.organization_snapshot),
        },

        forms: forms.map((form) => ({
          ...form,
          file_url: form.storage_key
            ? toFileUrl(form.storage_key)
            : null,
        })),

        profile_documents: profileDocuments
          .filter((document) => document.storage_key)
          .map((document) => ({
            ...document,
            file_url: toFileUrl(document.storage_key),
          })),

        attachments: attachments.map((attachment) => ({
          ...attachment,
          file_url: toFileUrl(attachment.storage_key),
        })),

        status_history: statusHistory,
      },
    });
  } catch (error) {
    console.error('Get candidate error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل تفاصيل المرشح.'
    );
  }
}

async function ensureCandidateReadyForPreliminaryAcceptance(
  connection,
  candidateId
) {
  const [[candidate]] = await connection.query(
    `
      SELECT
        id,
        employee_user_id,
        course_id
      FROM candidates
      WHERE id = ?
    `,
    [candidateId]
  );

  if (!candidate) {
    throw new Error('المرشح غير موجود.');
  }

  /*
    1. التحقق من كل الاستمارات الإلزامية.
  */
  const [incompleteForms] = await connection.query(
    `
      SELECT
        cf.title,
        cfs.status
      FROM course_forms cf
      LEFT JOIN candidate_form_submissions cfs
        ON cfs.course_form_id = cf.id
        AND cfs.candidate_id = ?

      WHERE cf.course_id = ?
        AND cf.deleted_at IS NULL
        AND cf.is_required = 1
        AND (
          cfs.id IS NULL
          OR cfs.status <> 'APPROVED'
        )

      ORDER BY cf.display_order, cf.title
    `,
    [
      candidateId,
      candidate.course_id,
    ]
  );

  if (incompleteForms.length) {
    const formNames = incompleteForms
      .map((form) => form.title)
      .join('، ');

    throw new Error(
      `لا يمكن القبول المبدئي قبل اعتماد جميع الاستمارات الإلزامية: ${formNames}.`
    );
  }

  /*
    2. التحقق من جواز السفر الشخصي.
    يجب أن يكون موجودًا وله نسخة مرفوعة وحالته APPROVED.
  */
  const [[passport]] = await connection.query(
    `
      SELECT
        pd.id
      FROM profile_documents pd
      INNER JOIN profile_document_versions pdv
        ON pdv.profile_document_id = pd.id
        AND pdv.version_no = (
          SELECT MAX(version_no)
          FROM profile_document_versions
          WHERE profile_document_id = pd.id
        )

      WHERE pd.user_profile_id = ?
        AND pd.document_type = 'PASSPORT'
        AND pd.deleted_at IS NULL
        AND pd.status = 'APPROVED'

      LIMIT 1
    `,
    [candidate.employee_user_id]
  );

  if (!passport) {
    throw new Error(
      'لا يمكن القبول المبدئي قبل اعتماد جواز سفر المرشح.'
    );
  }
}

async function updateCandidateStatus(req, res) {
  const actorUserId = getActorId(req);
  const { courseId, candidateId } = req.params;
  const { status, reason } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[candidate]] = await connection.query(
      `
        SELECT
          c.*,
          co.title AS course_title,
          co.total_seats
        FROM candidates c
        INNER JOIN courses co
          ON co.id = c.course_id
        WHERE c.id = ?
          AND c.course_id = ?
        FOR UPDATE
      `,
      [candidateId, courseId]
    );

    if (!candidate) {
      throw new Error('المرشح غير موجود.');
    }

    /*
      القبول المبدئي مشروط باعتماد:
      - كل الاستمارات الإلزامية
      - جواز السفر الشخصي
    */
    if (status === 'PRELIMINARILY_ACCEPTED') {
      await ensureCandidateReadyForPreliminaryAcceptance(
        connection,
        candidateId
      );
    }

    /*
      فقط التأكيد النهائي وما بعده يستهلك مقعدًا.
    */
    if (status === 'CONFIRMED') {
      const [[confirmedCount]] = await connection.query(
        `
          SELECT COUNT(*) AS total
          FROM candidates
          WHERE course_id = ?
            AND id <> ?
            AND status IN (
              'CONFIRMED',
              'PARTICIPATING',
              'COMPLETED'
            )
        `,
        [courseId, candidateId]
      );

      if (Number(confirmedCount.total) >= Number(candidate.total_seats)) {
        throw new Error(
          'لا يمكن تأكيد المرشح؛ اكتمل إجمالي المقاعد النهائية للدورة.'
        );
      }
    }

    const confirmedAt =
      status === 'CONFIRMED'
        ? new Date()
        : candidate.confirmed_at;

    await connection.query(
      `
        UPDATE candidates
        SET
          status = ?,
          confirmed_at = ?,
          removal_reason = ?
        WHERE id = ?
      `,
      [
        status,
        confirmedAt,
        status === 'REJECTED'
          ? reason
          : candidate.removal_reason,
        candidateId,
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
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        candidateId,
        candidate.status,
        status,
        reason || null,
        actorUserId,
      ]
    );

    const notifications = {
      PRELIMINARILY_ACCEPTED: {
        type: 'CANDIDATE_PRELIMINARILY_ACCEPTED',
        title: 'تم قبولك مبدئيًا',
        message: `تم قبولك مبدئيًا في الدورة: ${candidate.course_title}.`,
      },

      CONFIRMED: {
        type: 'CANDIDATE_CONFIRMED',
        title: 'تم تأكيد قبولك',
        message: `تم تأكيد قبولك في الدورة: ${candidate.course_title}.`,
      },

      REJECTED: {
        type: 'CANDIDATE_FINAL_REJECTED',
        title: 'نتيجة طلب الترشح',
        message: `تم رفض ترشحك نهائيًا للدورة: ${candidate.course_title}. السبب: ${reason}`,
      },
    };

    if (notifications[status]) {
      const notification = notifications[status];

      await createNotification(connection, {
        recipientUserId: candidate.employee_user_id,
        senderUserId: actorUserId,
        notificationType: notification.type,
        title: notification.title,
        message: notification.message,
        relatedEntityType: 'CANDIDATE',
        relatedEntityId: candidateId,
      });
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'CANDIDATE_STATUS_CHANGED',
      entityType: 'CANDIDATE',
      entityId: Number(candidateId),
      beforeData: {
        status: candidate.status,
      },
      afterData: {
        status,
        reason,
      },
    });

    await connection.commit();

    return res.json({
      message: 'تم تحديث حالة المرشح بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    console.error('Candidate status error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر تحديث حالة المرشح.'
    );
  } finally {
    connection.release();
  }
}

const reviewOperations = require('./admin-reviews')({
  fs, crypto, pool, writeAuditLog, createNotification, getActorId, sendError, normalizeOriginalName,
});
return { listCourseCandidates, addDirectCandidate, getCandidate, updateCandidateStatus,
  ...reviewOperations };
};

