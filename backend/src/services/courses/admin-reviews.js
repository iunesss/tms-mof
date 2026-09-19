/** مراجعة مستندات ونماذج المرشح وإرسال مرفقات الدورة إليه. */
module.exports = function createReviewOperations({
  fs, crypto, pool, writeAuditLog, createNotification, getActorId, sendError, normalizeOriginalName,
}) {
async function reviewCandidateDocument(req, res) {
  const actorUserId = getActorId(req);
  const { courseId, candidateId, documentId } = req.params;
  const { decision, reason } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[document]] = await connection.query(
      `
        SELECT
          cd.id,
          cd.current_version_no,
          c.employee_user_id,
          c.status AS candidate_status,
          co.title AS course_title,
          dr.title AS requirement_name,
          cdv.id AS version_id
        FROM candidate_documents cd
        INNER JOIN candidates c
          ON c.id = cd.candidate_id
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN document_requirements dr
          ON dr.id = cd.document_requirement_id
        LEFT JOIN candidate_document_versions cdv
          ON cdv.candidate_document_id = cd.id
          AND cdv.version_no = cd.current_version_no
        WHERE cd.id = ?
          AND cd.candidate_id = ?
          AND c.course_id = ?
        FOR UPDATE
      `,
      [documentId, candidateId, courseId]
    );

    if (!document) {
      throw new Error('المستند غير موجود.');
    }

    if (!document.version_id) {
      throw new Error('لا يمكن مراجعة مستند لم يتم رفعه بعد.');
    }

    await connection.query(
      `
        INSERT INTO candidate_document_reviews (
          candidate_document_version_id,
          reviewer_user_id,
          decision,
          rejection_reason
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        document.version_id,
        actorUserId,
        decision,
        decision === 'REJECTED' ? reason : null,
      ]
    );

    await connection.query(
      `
        UPDATE candidate_documents
        SET status = ?
        WHERE id = ?
      `,
      [
        decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        documentId,
      ]
    );

    if (decision === 'REJECTED') {
      if (document.candidate_status === 'DOCUMENTS_UNDER_REVIEW') {
        await connection.query(
          `
            UPDATE candidates
            SET status = 'DOCUMENTS_PENDING'
            WHERE id = ?
          `,
          [candidateId]
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
            VALUES (?, 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING', ?, ?)
          `,
          [
            candidateId,
            'طلب إعادة رفع مستند.',
            actorUserId,
          ]
        );
      }

      await createNotification(connection, {
        recipientUserId: document.employee_user_id,
        senderUserId: actorUserId,
        notificationType: 'CANDIDATE_DOCUMENT_RESUBMISSION_REQUIRED',
        title: 'مطلوب إعادة رفع مستند',
        message: `المستند "${document.requirement_name}" يحتاج تعديلًا في دورة "${document.course_title}". الملاحظة: ${reason}`,
        relatedEntityType: 'CANDIDATE_DOCUMENT',
        relatedEntityId: Number(documentId),
      });
    }

    await writeAuditLog(connection, {
      actorUserId,
      eventType: decision === 'APPROVED'
        ? 'CANDIDATE_DOCUMENT_APPROVED'
        : 'CANDIDATE_DOCUMENT_RESUBMISSION_REQUESTED',
      entityType: 'CANDIDATE_DOCUMENT',
      entityId: Number(documentId),
      afterData: { decision, reason },
    });

    await connection.commit();

    return res.json({
      message: decision === 'APPROVED'
        ? 'تم اعتماد المستند.'
        : 'تم إرسال طلب إعادة رفع المستند للموظف.',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Document review error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر مراجعة المستند.'
    );
  } finally {
    connection.release();
  }
}
async function reviewCandidateForm(req, res) {
  const { courseId, candidateId, formId } = req.params;
  const actorUserId = getActorId(req);

  const { decision, reason = null } = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[submission]] = await connection.query(
      `
        SELECT
          cfs.id,
          cfs.current_version_no,
          cfs.status,
          cf.title,
          c.employee_user_id,
          co.title AS course_title

        FROM candidate_form_submissions cfs
        INNER JOIN candidates c
          ON c.id = cfs.candidate_id
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN course_forms cf
          ON cf.id = cfs.course_form_id

      WHERE cfs.id = ?
  AND cfs.candidate_id = ?
  AND c.course_id = ?

        FOR UPDATE
      `,
[formId, candidateId, courseId]    );

    if (!submission) {
      throw new Error('الاستمارة غير موجودة ضمن هذا المرشح.');
    }

    if (!Number(submission.current_version_no)) {
      throw new Error('لا يمكن مراجعة استمارة لم يرفعها الموظف.');
    }

    await connection.query(
      `
        UPDATE candidate_form_submissions
        SET
          status = ?,
          reviewed_by_user_id = ?,
          reviewed_at = NOW(),
          rejection_reason = ?
        WHERE id = ?
      `,
      [
        decision,
        actorUserId,
        decision === 'REJECTED' ? reason : null,
        submission.id,
      ]
    );

    await createNotification(connection, {
      recipientUserId: submission.employee_user_id,
      senderUserId: actorUserId,
      notificationType:
        decision === 'APPROVED'
          ? 'COURSE_FORM_APPROVED'
          : 'COURSE_FORM_REJECTED',
      title:
        decision === 'APPROVED'
          ? 'تم اعتماد استمارتك'
          : 'مطلوب إعادة رفع استمارة',
      message:
        decision === 'APPROVED'
          ? `تم اعتماد استمارة "${submission.title}" للدورة: ${submission.course_title}.`
          : `تم رفض استمارة "${submission.title}" للدورة: ${submission.course_title}. السبب: ${reason}`,
      relatedEntityType: 'CANDIDATE_FORM_SUBMISSION',
      relatedEntityId: submission.id,
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'CANDIDATE_FORM_REVIEWED',
      entityType: 'CANDIDATE_FORM_SUBMISSION',
      entityId: submission.id,
      afterData: {
        decision,
        reason,
      },
    });

    await connection.commit();

    return res.json({
      message:
        decision === 'APPROVED'
          ? 'تم اعتماد الاستمارة.'
          : 'تم رفض الاستمارة وإشعار الموظف.',
    });
  } catch (error) {
    await connection.rollback();

    return sendError(
      res,
      400,
      error.message || 'تعذر مراجعة الاستمارة.'
    );
  } finally {
    connection.release();
  }
}

async function reviewProfileDocument(req, res) {
  const { courseId, candidateId, profileDocumentId } = req.params;
  const actorUserId = getActorId(req);

  const { decision, reason = null } = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[document]] = await connection.query(
      `
        SELECT
          pd.id,
          pd.label,
          pd.document_type,
          pdv.id AS profile_document_version_id,
          c.employee_user_id,
          co.title AS course_title

        FROM candidates c
        INNER JOIN courses co
          ON co.id = c.course_id
        INNER JOIN profile_documents pd
          ON pd.user_profile_id = c.employee_user_id
          AND pd.deleted_at IS NULL
        INNER JOIN profile_document_versions pdv
          ON pdv.profile_document_id = pd.id
          AND pdv.version_no = (
            SELECT MAX(version_no)
            FROM profile_document_versions
            WHERE profile_document_id = pd.id
          )

        WHERE c.id = ?
          AND c.course_id = ?
          AND pd.id = ?

        FOR UPDATE
      `,
      [candidateId, courseId, profileDocumentId]
    );

    if (!document) {
      throw new Error('مستند الملف الشخصي غير موجود.');
    }

    await connection.query(
      `
        UPDATE profile_documents
        SET status = ?
        WHERE id = ?
      `,
      [decision, document.id]
    );

    await connection.query(
      `
        INSERT INTO profile_document_reviews (
          profile_document_version_id,
          reviewer_user_id,
          decision,
          rejection_reason
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        document.profile_document_version_id,
        actorUserId,
        decision,
        decision === 'REJECTED' ? reason : null,
      ]
    );

    await createNotification(connection, {
      recipientUserId: document.employee_user_id,
      senderUserId: actorUserId,
      notificationType:
        decision === 'APPROVED'
          ? 'PROFILE_DOCUMENT_APPROVED'
          : 'PROFILE_DOCUMENT_REJECTED',
      title:
        decision === 'APPROVED'
          ? 'تم اعتماد مستندك الشخصي'
          : 'مطلوب إعادة رفع مستند شخصي',
      message:
        decision === 'APPROVED'
          ? `تم اعتماد مستند "${document.label}" ضمن متطلبات الدورة: ${document.course_title}.`
          : `تم رفض مستند "${document.label}". السبب: ${reason}`,
      relatedEntityType: 'PROFILE_DOCUMENT',
      relatedEntityId: document.id,
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'PROFILE_DOCUMENT_REVIEWED',
      entityType: 'PROFILE_DOCUMENT',
      entityId: document.id,
      afterData: {
        decision,
        reason,
      },
    });

    await connection.commit();

    return res.json({
      message:
        decision === 'APPROVED'
          ? 'تم اعتماد المستند.'
          : 'تم رفض المستند وإشعار الموظف.',
    });
  } catch (error) {
    await connection.rollback();

    return sendError(
      res,
      400,
      error.message || 'تعذر مراجعة المستند الشخصي.'
    );
  } finally {
    connection.release();
  }
}
async function selectNominationCandidate(req, res) {
  const courseId = Number(req.params.courseId);
  const nominationId = Number(req.params.nominationId);

  if (
    !Number.isInteger(courseId) || courseId <= 0 ||
    !Number.isInteger(nominationId) || nominationId <= 0
  ) {
    return sendError(res, 400, 'معرّف الدورة أو الترشيح غير صالح.');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[nomination]] = await connection.query(
      `
        SELECT n.id
        FROM nominations n
        LEFT JOIN candidates c
          ON c.source_nomination_id = n.id
        WHERE n.id = ?
          AND n.course_id = ?
          AND n.status = 'AGENT_CONFIRMED'
          AND c.id IS NULL
        FOR UPDATE
      `,
      [nominationId, courseId]
    );

    if (!nomination) {
      throw new Error(
        'الترشيح غير معتمد من الوكيل، أو اختارته اللجنة مسبقًا.'
      );
    }

    await connection.query(
      'SET @app_user_id = ?',
      [req.user.id]
    );

    await connection.query(
      'CALL sp_select_candidate_from_nomination(?)',
      [nominationId]
    );

    await connection.commit();

    return res.status(201).json({
      message: 'تم اختيار المرشح بنجاح.',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Select nomination candidate error:', error);

    return sendError(
      res,
      400,
      error.message || 'تعذر اختيار المرشح.'
    );
  } finally {
    await connection.query('SET @app_user_id = NULL');
    connection.release();
  }
}
async function uploadCandidateAttachment(req, res) {
  const { courseId, candidateId } = req.params;
  const actorUserId = getActorId(req);

  const { attachmentType, note = null } = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[candidate]] = await connection.query(
      `
        SELECT
          c.id,
          c.employee_user_id,
          co.title AS course_title
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
      throw new Error('المرشح غير موجود ضمن هذه الدورة.');
    }

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(req.file.path))
      .digest('hex');

const storageKey =
  `candidate-attachments/${req.file.filename}`;
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
        actorUserId,
      ]
    );

    const [attachmentResult] = await connection.query(
      `
        INSERT INTO candidate_attachments (
          candidate_id,
          attachment_type,
          file_id,
          uploaded_by_user_id,
          note
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        candidateId,
        attachmentType,
        fileResult.insertId,
        actorUserId,
        note,
      ]
    );

    await createNotification(connection, {
      recipientUserId: candidate.employee_user_id,
      senderUserId: actorUserId,
      notificationType: 'CANDIDATE_ATTACHMENT_SENT',
      title: 'تم إرسال مستند جديد لك',
      message: `تم إرسال مستند جديد للدورة: ${candidate.course_title}.`,
      relatedEntityType: 'CANDIDATE_ATTACHMENT',
      relatedEntityId: attachmentResult.insertId,
    });

    await writeAuditLog(connection, {
      actorUserId,
      eventType: 'CANDIDATE_ATTACHMENT_UPLOADED',
      entityType: 'CANDIDATE_ATTACHMENT',
      entityId: attachmentResult.insertId,
      afterData: {
        course_id: Number(courseId),
        candidate_id: Number(candidateId),
        attachment_type: attachmentType,
        note,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message: 'تم رفع المستند وإرساله للمرشح بنجاح.',
    });
  } catch (error) {
    await connection.rollback();

    return sendError(
      res,
      400,
      error.message || 'تعذر رفع مستند المرشح.'
    );
  } finally {
    connection.release();
  }
}


return { reviewCandidateDocument, reviewCandidateForm, reviewProfileDocument,
  uploadCandidateAttachment, selectNominationCandidate };
};

