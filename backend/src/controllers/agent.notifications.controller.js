const pool = require('../config/database');

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function getCategory(notificationType = '') {
  const type = String(notificationType).toUpperCase();

  if (
    type.includes('NOMINATION') ||
    type.includes('CANDIDATE')
  ) {
    return 'NOMINATIONS';
  }

  if (
    type.includes('DOCUMENT') ||
    type.includes('FORM')
  ) {
    return 'DOCUMENTS';
  }

  if (
    type.includes('COURSE') ||
    type.includes('MISSION') ||
    type.includes('INVITATION')
  ) {
    return 'COURSES';
  }

  return 'GENERAL';
}

function applyCategoryFilter(category, conditions) {
  if (category === 'NOMINATIONS') {
    conditions.push(`
      (
        n.notification_type LIKE '%NOMINATION%'
        OR n.notification_type LIKE '%CANDIDATE%'
      )
    `);
  }

  if (category === 'DOCUMENTS') {
    conditions.push(`
      (
        n.notification_type LIKE '%DOCUMENT%'
        OR n.notification_type LIKE '%FORM%'
      )
    `);
  }

  if (category === 'COURSES') {
    conditions.push(`
      (
        n.notification_type LIKE '%COURSE%'
        OR n.notification_type LIKE '%MISSION%'
        OR n.notification_type LIKE '%INVITATION%'
      )
    `);
  }

  if (category === 'GENERAL') {
    conditions.push(`
      n.notification_type NOT LIKE '%NOMINATION%'
      AND n.notification_type NOT LIKE '%CANDIDATE%'
      AND n.notification_type NOT LIKE '%DOCUMENT%'
      AND n.notification_type NOT LIKE '%FORM%'
      AND n.notification_type NOT LIKE '%COURSE%'
      AND n.notification_type NOT LIKE '%MISSION%'
      AND n.notification_type NOT LIKE '%INVITATION%'
    `);
  }
}

async function listNotifications(req, res) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 12, 1),
      50
    );

    const offset = (page - 1) * limit;
    const category = String(req.query.category || '')
      .trim()
      .toUpperCase();

    const readStatus = String(req.query.readStatus || '')
      .trim()
      .toUpperCase();

    const search = String(req.query.search || '').trim();

    const conditions = [
      'n.recipient_user_id = ?',
    ];

    const values = [req.user.id];

    const allowedCategories = [
      'NOMINATIONS',
      'COURSES',
      'DOCUMENTS',
      'GENERAL',
    ];

    if (allowedCategories.includes(category)) {
      applyCategoryFilter(category, conditions);
    }

    if (readStatus === 'UNREAD') {
      conditions.push('n.is_read = FALSE');
    }

    if (readStatus === 'READ') {
      conditions.push('n.is_read = TRUE');
    }

    if (search) {
      conditions.push(`
        (
          n.title LIKE ?
          OR n.message LIKE ?
          OR n.notification_type LIKE ?
        )
      `);

      const searchValue = `%${search}%`;

      values.push(
        searchValue,
        searchValue,
        searchValue
      );
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM notifications n
        WHERE ${whereClause}
      `,
      values
    );

    const [notifications] = await pool.query(
      `
        SELECT
          n.id,
          n.notification_type,
          n.title,
          n.message,
          n.related_entity_type,
          n.related_entity_id,
          n.is_read,
          n.created_at,

          sender.username AS sender_username,
          sender_profile.full_name AS sender_full_name

        FROM notifications n

        LEFT JOIN users sender
          ON sender.id = n.sender_user_id

        LEFT JOIN user_profiles sender_profile
          ON sender_profile.user_id = sender.id

        WHERE ${whereClause}

        ORDER BY
          n.is_read ASC,
          n.created_at DESC

        LIMIT ? OFFSET ?
      `,
      [...values, limit, offset]
    );

    const [[unreadRow]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM notifications
        WHERE recipient_user_id = ?
          AND is_read = FALSE
      `,
      [req.user.id]
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      unreadCount: Number(unreadRow?.total || 0),

      notifications: notifications.map((notification) => ({
        ...notification,
        is_read: Boolean(notification.is_read),
        category: getCategory(notification.notification_type),
        sender_name:
          notification.sender_full_name ||
          notification.sender_username ||
          'النظام',
      })),

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Agent list notifications error:', error);

    return sendError(
      res,
      500,
      'تعذر تحميل الإشعارات.'
    );
  }
}

async function markNotificationAsRead(req, res) {
  try {
    const notificationId = Number(req.params.notificationId);

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return sendError(res, 400, 'معرّف الإشعار غير صالح.');
    }

    const [result] = await pool.query(
      `
        UPDATE notifications
        SET is_read = TRUE
        WHERE id = ?
          AND recipient_user_id = ?
      `,
      [notificationId, req.user.id]
    );

    if (!result.affectedRows) {
      return sendError(res, 404, 'الإشعار غير موجود.');
    }

    return res.json({
      message: 'تم تحديد الإشعار كمقروء.',
    });
  } catch (error) {
    console.error('Agent read notification error:', error);

    return sendError(
      res,
      500,
      'تعذر تحديث الإشعار.'
    );
  }
}

async function markAllNotificationsAsRead(req, res) {
  try {
    await pool.query(
      `
        UPDATE notifications
        SET is_read = TRUE
        WHERE recipient_user_id = ?
          AND is_read = FALSE
      `,
      [req.user.id]
    );

    return res.json({
      message: 'تم تحديد جميع الإشعارات كمقروءة.',
    });
  } catch (error) {
    console.error('Agent read all notifications error:', error);

    return sendError(
      res,
      500,
      'تعذر تحديث الإشعارات.'
    );
  }
}

module.exports = {
  listNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};