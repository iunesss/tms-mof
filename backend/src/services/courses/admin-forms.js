/** يحفظ مرفقات الدورة ويزامن نماذج الاستمارات المطلوبة. */
module.exports = function createCourseFormHelpers({ fs, crypto, normalizeOriginalName }) {
async function saveUploadedFiles(connection, files, actorUserId, courseId) {
  const fileFields = [
    ['agenda', 'AGENDA'],
    ['program', 'PROGRAM'],
    ['invitationTemplate', 'GENERAL_INVITATION'],
    ['attachment', 'OTHER'],
  ];

  for (const [fieldName, attachmentType] of fileFields) {
    const file = files?.[fieldName]?.[0];

    if (!file) {
      continue;
    }

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file.path))
      .digest('hex');

    const storageKey = `courses/${file.filename}`;
    const originalName = normalizeOriginalName(file.originalname);

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
        file.mimetype,
        file.size,
        checksum,
        actorUserId,
      ]
    );

    await connection.query(
      `
        INSERT INTO course_attachments (
          course_id,
          file_id,
          attachment_type,
          uploaded_by_user_id
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        courseId,
        fileResult.insertId,
        attachmentType,
        actorUserId,
      ]
    );
  }
}
async function syncCourseForms(
  connection,
  files,
  courseForms,
  removedCourseFormIds,
  actorUserId,
  courseId
) {
  const templateFiles = files?.courseFormTemplates || [];

  /*
    Soft Delete للنماذج التي حذفها مدير الدورة من واجهة التعديل.
    لا نحذفها فعليًا حتى لا نخسر تاريخ المرشحين.
  */
  if (removedCourseFormIds?.length) {
    const placeholders = removedCourseFormIds.map(() => '?').join(',');

    await connection.query(
      `
        UPDATE course_forms
        SET deleted_at = NOW()
        WHERE course_id = ?
          AND id IN (${placeholders})
          AND deleted_at IS NULL
      `,
      [courseId, ...removedCourseFormIds]
    );
  }

  for (const form of courseForms || []) {
    /*
      النموذج الموجود سابقًا لا يحتاج ملفًا جديدًا.
      يمكن تعديل عنوانه وإلزاميته وموعده.
    */
    if (form.id) {
      await connection.query(
        `
          UPDATE course_forms
          SET
            title = ?,
            is_required = ?,
            due_at = ?
          WHERE id = ?
            AND course_id = ?
            AND deleted_at IS NULL
        `,
        [
          form.title,
          form.isRequired ? 1 : 0,
          form.dueAt || null,
          form.id,
          courseId,
        ]
      );

      continue;
    }

    /*
      نموذج جديد: يجب أن يملك ملف Template مطابقًا لـ fileIndex.
    */
    const file = templateFiles[form.fileIndex];

    if (!file) {
      throw new Error(
        `يرجى اختيار ملف للاستـمارة: ${form.title || 'بدون اسم'}.`
      );
    }

    if (!form.title) {
      throw new Error('يرجى كتابة اسم كل استمارة مضافة.');
    }

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file.path))
      .digest('hex');

    const rawName = file.originalname;

    const originalName = /[\u00C0-\u00FF]/.test(rawName)
      ? Buffer.from(rawName, 'latin1').toString('utf8')
      : rawName;

    const storageKey = `courses/${file.filename}`;

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
        file.mimetype,
        file.size,
        checksum,
        actorUserId,
      ]
    );

    const [courseFormResult] = await connection.query(
      `
        INSERT INTO course_forms (
          course_id,
          title,
          template_file_id,
          is_required,
          due_at,
          display_order,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        courseId,
        form.title,
        fileResult.insertId,
        form.isRequired ? 1 : 0,
        form.dueAt || null,
        form.fileIndex || 0,
        actorUserId,
      ]
    );

    /*
      إذا أضيفت استمارة بعد وجود مرشحين،
      ننشئ Submission Pending لكل مرشح حالي.
    */
    await connection.query(
      `
        INSERT INTO candidate_form_submissions (
          candidate_id,
          course_form_id
        )
        SELECT c.id, ?
        FROM candidates c
        WHERE c.course_id = ?
          AND c.status NOT IN (
            'REJECTED',
            'WITHDRAWN',
            'REMOVED',
            'CANCELLED'
          )
      `,
      [courseFormResult.insertId, courseId]
    );
  }
}



return { saveUploadedFiles, syncCourseForms };
};

