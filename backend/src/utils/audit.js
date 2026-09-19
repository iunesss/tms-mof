/** يسجل التغيير داخل transaction العملية الأصلية ويكشف الحقول الناقصة مبكرًا. */
async function writeAuditLog(
  connection,
  {
    actorUserId = null,
    eventType,
    entityType,
    entityId,
    beforeData = null,
    afterData = null,
  }
) {
  // التحقق من صحة المعطيات المدخلة
  if (!connection?.query || !eventType || !entityType || entityId == null) {
    throw new TypeError('Audit log requires a connection, eventType, entityType and entityId.');
  }

  await connection.query(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        event_type,
        entity_type,
        entity_id,
        before_data,
        after_data
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      actorUserId,
      eventType,
      entityType,
      entityId,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
    ]
  );
}

module.exports = {
  writeAuditLog,
};
