/** ينشئ الإشعار داخل transaction العملية الأصلية حتى لا يُرسل عن عملية فاشلة. */
async function createNotification(
  connection,
  {
    recipientUserId,
    senderUserId = null,
    notificationType,
    title,
    message,
    relatedEntityType = null,
    relatedEntityId = null,
  }
) {
  // التحقق من صحة المعطيات المدخلة
  if (!connection?.query || recipientUserId == null || !notificationType || !title || !message) {
    throw new TypeError('Notification requires a connection, recipient, type, title and message.');
  }

  await connection.query(
    `
      INSERT INTO notifications (
        recipient_user_id,
        sender_user_id,
        notification_type,
        title,
        message,
        related_entity_type,
        related_entity_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      recipientUserId,
      senderUserId,
      notificationType,
      title,
      message,
      relatedEntityType,
      relatedEntityId,
    ]
  );
}

/** يرسل الإشعار نفسه إلى مستخدمين متعددين مع حذف التكرار ومنفذ العملية. */
async function createNotifications(connection, recipientUserIds, notification) {
  const recipients = [...new Set(recipientUserIds.map(Number))]
    .filter((userId) => userId > 0 && userId !== Number(notification.senderUserId));

  for (const recipientUserId of recipients) {
    await createNotification(connection, { ...notification, recipientUserId });
  }
}

/** يعيد الحسابات النشطة التابعة لدور محدد. */
async function getActiveUserIdsByRole(connection, roleCode) {
  const [rows] = await connection.query(
    `SELECT DISTINCT u.id
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE r.code = ? AND u.is_active = TRUE AND u.deleted_at IS NULL`,
    [roleCode]
  );
  return rows.map((row) => Number(row.id));
}

/** يبلغ مديري الدورات النشطين بحدث يحتاج متابعتهم. */
async function notifyCourseManagers(connection, notification) {
  const recipients = await getActiveUserIdsByRole(connection, 'COURSE_MANAGER');
  await createNotifications(connection, recipients, notification);
}

/**
 * يبلغ أصحاب العلاقة بالدورة عند تغير حالتها: مديري الأقسام المخصصة،
 * وكلاء القطاعات المستهدفة، والموظفين الذين أصبحوا مرشحين.
 */
async function notifyCourseStakeholders(
  connection,
  courseId,
  notification,
  {
    excludeDepartmentManagers = false,
    excludeAgents = false,
    excludeCandidates = false,
  } = {}
) {
  const [rows] = await connection.query(
    `SELECT recipient_user_id, recipient_kind
     FROM (
       SELECT dma.manager_user_id AS recipient_user_id, 'DEPARTMENT_MANAGER' AS recipient_kind
       FROM course_department_allocations cda
       INNER JOIN department_manager_assignments dma
         ON dma.department_id = cda.department_id AND dma.end_date IS NULL
       WHERE cda.course_id = ?
       UNION
       SELECT saa.agent_user_id, 'AGENT'
       FROM course_sector_targets cst
       INNER JOIN sector_agent_assignments saa
         ON saa.sector_id = cst.sector_id AND saa.end_date IS NULL
       WHERE cst.course_id = ?
       UNION
       SELECT c.employee_user_id, 'CANDIDATE'
       FROM candidates c
       WHERE c.course_id = ?
         AND c.status NOT IN ('REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED')
     ) recipients`,
    [courseId, courseId, courseId]
  );
  await createNotifications(
    connection,
    rows
      .filter((row) => !(
        (excludeDepartmentManagers && row.recipient_kind === 'DEPARTMENT_MANAGER') ||
        (excludeAgents && row.recipient_kind === 'AGENT') ||
        (excludeCandidates && row.recipient_kind === 'CANDIDATE')
      ))
      .map((row) => row.recipient_user_id),
    notification
  );
}

module.exports = {
  createNotification,
  createNotifications,
  getActiveUserIdsByRole,
  notifyCourseManagers,
  notifyCourseStakeholders,
};
