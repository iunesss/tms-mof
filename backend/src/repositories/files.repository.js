const pool = require('../config/database');

/** يبحث بالمفتاح المسجل فقط؛ الملفات المحذوفة لا تصل إلى طبقة التنزيل. */
async function findFile(storageKey) {
  const [rows] = await pool.execute(
    'SELECT id, storage_key, mime_type FROM files WHERE storage_key = ? AND deleted_at IS NULL LIMIT 1',
    [storageKey]
  );
  return rows[0] || null;
}

/**
 * يحدد مالك المستند أو الدورة المرتبط بها من العلاقات الفعلية.
 * مستند الموظف الخاص لا يصبح متاحًا لمدير قسمه أو وكيله لمجرد الانتماء الإداري.
 */
async function getFileReferences(fileId) {
  const [rows] = await pool.execute(
    `SELECT 'private' AS kind, pd.user_profile_id AS owner_user_id, NULL AS course_id
     FROM profile_document_versions v JOIN profile_documents pd ON pd.id = v.profile_document_id
     WHERE v.file_id = ? AND pd.deleted_at IS NULL
     UNION ALL
     SELECT 'private', c.employee_user_id, c.course_id
     FROM candidate_attachments a JOIN candidates c ON c.id = a.candidate_id
     JOIN courses co ON co.id = c.course_id
     WHERE a.file_id = ? AND a.deleted_at IS NULL AND co.deleted_at IS NULL
     UNION ALL
     SELECT 'private', c.employee_user_id, c.course_id
     FROM candidate_document_versions v JOIN candidate_documents d ON d.id = v.candidate_document_id
     JOIN candidates c ON c.id = d.candidate_id JOIN courses co ON co.id = c.course_id
     WHERE v.file_id = ? AND co.deleted_at IS NULL
     UNION ALL
     SELECT 'private', c.employee_user_id, c.course_id
     FROM form_submission_versions v JOIN candidate_form_submissions f ON f.id = v.candidate_form_submission_id
     JOIN candidates c ON c.id = f.candidate_id JOIN courses co ON co.id = c.course_id
     WHERE v.file_id = ? AND co.deleted_at IS NULL
     UNION ALL
     SELECT 'course', NULL, a.course_id FROM course_attachments a
     JOIN courses co ON co.id = a.course_id
     WHERE a.file_id = ? AND a.deleted_at IS NULL AND co.deleted_at IS NULL
     UNION ALL
     SELECT 'course', NULL, f.course_id FROM course_forms f
     JOIN courses co ON co.id = f.course_id
     WHERE f.template_file_id = ? AND f.deleted_at IS NULL AND co.deleted_at IS NULL
     UNION ALL
     SELECT 'course', NULL, r.course_id FROM course_reports r
     JOIN courses co ON co.id = r.course_id
     WHERE r.file_id = ? AND r.deleted_at IS NULL AND co.deleted_at IS NULL`,
    Array(7).fill(fileId)
  );
  return rows;
}

/** يتحقق من نطاق مرفقات الدورة العامة: مشارك، قسم مستهدف، أو قطاع مستهدف حاليًا. */
async function canReadCourse(courseId, user) {
  const [rows] = await pool.execute(
    `SELECT co.id FROM courses co WHERE co.id = ? AND co.deleted_at IS NULL AND (
       EXISTS (
         SELECT 1 FROM candidates c WHERE c.course_id = co.id AND c.employee_user_id = ?
         AND c.status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
       )
       OR (? = 1 AND EXISTS (
         SELECT 1 FROM course_sector_targets t JOIN sector_agent_assignments a ON a.sector_id = t.sector_id
         WHERE t.course_id = co.id AND a.agent_user_id = ? AND a.end_date IS NULL
       ))
       OR (? = 1 AND EXISTS (
         SELECT 1 FROM department_manager_assignments a
         WHERE a.manager_user_id = ? AND a.end_date IS NULL AND (
           (co.course_type = 'TRAINING' AND EXISTS (
             SELECT 1 FROM course_department_allocations d
             WHERE d.course_id = co.id AND d.department_id = a.department_id
           ))
           OR (co.course_type = 'MISSION' AND EXISTS (
             SELECT 1 FROM candidates c JOIN candidate_snapshots s ON s.candidate_id = c.id
             WHERE c.course_id = co.id
               AND c.status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
               AND CAST(JSON_UNQUOTE(JSON_EXTRACT(s.organization_snapshot, '$.department_id')) AS UNSIGNED) = a.department_id
           ))
         )
       ))
     ) LIMIT 1`,
    [courseId, user.id, Number(user.roles.includes('AGENT')), user.id,
      Number(user.roles.includes('DEPARTMENT_MANAGER')), user.id]
  );
  return rows.length > 0;
}

module.exports = { findFile, getFileReferences, canReadCourse };
