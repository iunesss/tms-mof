const fs = require('fs');
const crypto = require('crypto');
const pool = require('../../config/database');
const { writeAuditLog } = require('../../utils/audit');
const { createNotification } = require('../../utils/notifications');

function getActorId(req) {
  return req.user.id;
}

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function parseJson(value) {
  if (!value) return {};

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toFileUrl(storageKey) {
  const baseUrl = process.env.API_PUBLIC_URL || 'http://localhost:3000';
  return `${baseUrl}/uploads/${storageKey}`;
}
function normalizeOriginalName(fileName = '') {
  /*
    يعالج أسماء الملفات العربية إذا وصل الاسم بترميز latin1.
  */
  if (/[\u00C0-\u00FF]/.test(fileName)) {
    const decoded = Buffer.from(
      fileName,
      'latin1'
    ).toString('utf8');

    if (!decoded.includes('\uFFFD')) {
      return decoded;
    }
  }

  return fileName;
}
function toUiStatus(dbStatus) {
  if (
    dbStatus === 'OPEN_FOR_NOMINATION' ||
    dbStatus === 'NOMINATION_CLOSED' ||
    dbStatus === 'CANDIDATE_PROCESSING'
  ) {
    return 'ACTIVE';
  }

  return dbStatus;
}

function toDatabaseStatus(courseType, uiStatus) {
  /*
    الحالات النهائية لا يجوز تحويلها إلى دورة مفتوحة
    عند تعديل بياناتها.
  */
  if (
    ['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(uiStatus)
  ) {
    return uiStatus;
  }

  if (uiStatus === 'DRAFT') {
    return 'DRAFT';
  }

  if (courseType === 'TRAINING') {
    return 'OPEN_FOR_NOMINATION';
  }

  return 'CANDIDATE_PROCESSING';
}

async function generateCourseNumber(connection) {
  const year = new Date().getFullYear();

  const [[result]] = await connection.query(
    `
      SELECT COUNT(*) + 1 AS next_number
      FROM courses
      WHERE course_no LIKE ?
    `,
    [`CRS-${year}-%`]
  );

  return `CRS-${year}-${String(result.next_number).padStart(4, '0')}`;
}

const { saveUploadedFiles, syncCourseForms } = require('./admin-forms')({
  fs, crypto, normalizeOriginalName,
});

async function validateDepartments(connection, allocations) {
  const departmentIds = allocations.map(
    (allocation) => allocation.departmentId
  );

  const [departments] = await connection.query(
    `
      SELECT id, sector_id, name
      FROM departments
      WHERE id IN (?)
        AND deleted_at IS NULL
    `,
    [departmentIds]
  );

  if (departments.length !== departmentIds.length) {
    throw new Error('يوجد قسم غير صالح أو محذوف ضمن توزيع الترشيحات.');
  }

  return departments;
}

/*
  total_seats:
  عدد المقبولين النهائيين للدورة.

  nomination_limit:
  الحد الأعلى لترشيحات كل قسم، ويمكن أن يكون أكبر من total_seats.
*/
async function syncTargetsAndLimits(
  connection,
  courseId,
  allocations,
  actorUserId
) {
  const departments = await validateDepartments(connection, allocations);

  await connection.query(
    'DELETE FROM course_department_allocations WHERE course_id = ?',
    [courseId]
  );

  await connection.query(
    'DELETE FROM course_sector_targets WHERE course_id = ?',
    [courseId]
  );

  const departmentsById = new Map(
    departments.map((department) => [
      Number(department.id),
      department,
    ])
  );

  const sectorIds = new Set();

  for (const allocation of allocations) {
    const department = departmentsById.get(
      Number(allocation.departmentId)
    );

    sectorIds.add(department.sector_id);

    await connection.query(
      `
        INSERT INTO course_department_allocations (
          course_id,
          department_id,
          nomination_limit,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        courseId,
        allocation.departmentId,
        allocation.nominationLimit,
        actorUserId,
        actorUserId,
      ]
    );
  }

  for (const sectorId of sectorIds) {
    await connection.query(
      `
        INSERT INTO course_sector_targets (
          course_id,
          sector_id,
          added_by_user_id
        )
        VALUES (?, ?, ?)
      `,
      [courseId, sectorId, actorUserId]
    );
  }
}

/*
  لا توجد دعوة وكيل.
  الدورة النشطة ترسل دعوة مباشرة لكل مدير قسم تم اختياره.
*/
async function sendDepartmentManagerInvitations(
  connection,
  courseId,
  actorUserId,
  courseTitle
) {
  const [departments] = await connection.query(
    `
      SELECT
        cda.department_id,
        d.sector_id,
        dma.manager_user_id
      FROM course_department_allocations cda
      INNER JOIN departments d
        ON d.id = cda.department_id
      INNER JOIN department_manager_assignments dma
        ON dma.department_id = cda.department_id
        AND dma.end_date IS NULL
      INNER JOIN users u
        ON u.id = dma.manager_user_id
      WHERE cda.course_id = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `,
    [courseId]
  );

  const [[allocationsCount]] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM course_department_allocations
      WHERE course_id = ?
    `,
    [courseId]
  );

  if (departments.length !== allocationsCount.total) {
    throw new Error(
      'لا يمكن تفعيل الدورة: أحد الأقسام المحددة لا يملك مدير قسم فعالًا.'
    );
  }

  for (const department of departments) {
    const [[existingInvitation]] = await connection.query(
      `
        SELECT id
        FROM course_invitations
        WHERE course_id = ?
          AND recipient_user_id = ?
          AND department_id = ?
          AND invitation_type = 'DEPARTMENT_MANAGER_INVITATION'
          AND status IN ('PENDING', 'VIEWED', 'ACCEPTED')
      `,
      [
        courseId,
        department.manager_user_id,
        department.department_id,
      ]
    );

    if (existingInvitation) continue;

    const [invitationResult] = await connection.query(
      `
        INSERT INTO course_invitations (
          course_id,
          sender_user_id,
          recipient_user_id,
          sector_id,
          department_id,
          invitation_type,
          status
        )
        VALUES (?, ?, ?, ?, ?, 'DEPARTMENT_MANAGER_INVITATION', 'PENDING')
      `,
      [
        courseId,
        actorUserId,
        department.manager_user_id,
        department.sector_id,
        department.department_id,
      ]
    );

    await connection.query(
      `
        INSERT INTO invitation_actions (
          invitation_id,
          action,
          actor_user_id,
          note
        )
        VALUES (?, 'SENT', ?, ?)
      `,
      [
        invitationResult.insertId,
        actorUserId,
        'تم إرسال دعوة مباشرة لمدير القسم.',
      ]
    );

    await createNotification(connection, {
      recipientUserId: department.manager_user_id,
      senderUserId: actorUserId,
      notificationType: 'COURSE_DEPARTMENT_MANAGER_INVITATION',
      title: 'دعوة لترشيح موظفي القسم',
      message: `لديك دعوة جديدة لترشيح موظفين من قسمك في الدورة: ${courseTitle}`,
      relatedEntityType: 'COURSE_INVITATION',
      relatedEntityId: invitationResult.insertId,
    });
  }
}

const { createMissionCandidate, notifyMissionCandidates } = require('./admin-missions')({
  createNotification,
});

// دوال مساعدة مشتركة لتجهيز بيانات الدورة وربط الأقسام قبل عمليات الإدارة.
module.exports = {
  fs, crypto, pool, writeAuditLog, createNotification, getActorId, sendError,
  parseJson, toFileUrl, normalizeOriginalName, toUiStatus, toDatabaseStatus,
  generateCourseNumber, saveUploadedFiles, syncCourseForms,
  syncTargetsAndLimits, sendDepartmentManagerInvitations, createMissionCandidate,
  notifyMissionCandidates,
};




