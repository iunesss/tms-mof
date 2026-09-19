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

module.exports = {
  createNotification,
};
