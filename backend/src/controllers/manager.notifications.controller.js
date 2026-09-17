const pool = require('../config/database');

function getCategory(notificationType = '') {
  const type = String(notificationType).toUpperCase();

  if (type.includes('NOMINATION') || type.includes('CANDIDATE')) {
    return 'NOMINATIONS';
  }

  if (type.includes('DOCUMENT') || type.includes('FORM')) {
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

function buildFilters(query, userId) {
  const conditions = ['n.recipient_user_id = ?'];
  const values = [userId];

  const category = String(query.category || '').trim();
  const readStatus = String(query.readStatus || '').trim();
  const search = String(query.search || '').trim();

  if (readStatus === 'UNREAD') {
    conditions.push('n.is_read = 0');
  }

  if (readStatus === 'READ') {
    conditions.push('n.is_read = 1');
  }

  if (search) {
    conditions.push(`
      (
        n.title LIKE ?
        OR n.message LIKE ?
      )
    `);

    const searchValue = `%${search}%`;
    values.push(searchValue, searchValue);
  }

  if (category) {
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

  return { conditions, values };
}

async function listNotifications(req, res, next) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const offset = (page - 1) * limit;

    const { conditions, values } = buildFilters(req.query, req.user.id);
    const whereClause = conditions.join(' AND ');

    const [[countResult]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM notifications n
        WHERE ${whereClause}
      `,
      values
    );

    const [[unreadResult]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM notifications
        WHERE recipient_user_id = ?
          AND is_read = 0
      `,
      [req.user.id]
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

          sender_profile.full_name AS sender_name

        FROM notifications n
        LEFT JOIN user_profiles sender_profile
          ON sender_profile.user_id = n.sender_user_id

        WHERE ${whereClause}

        ORDER BY
          n.is_read ASC,
          n.created_at DESC

        LIMIT ? OFFSET ?
      `,
      [...values, limit, offset]
    );

    const total = Number(countResult.total || 0);
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.status(200).json({
      notifications: notifications.map((notification) => ({
        ...notification,
        category: getCategory(notification.notification_type),
        is_read: Boolean(notification.is_read),
      })),
      unreadCount: Number(unreadResult.total || 0),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function markNotificationAsRead(req, res, next) {
  try {
    const notificationId = Number(req.params.notificationId);

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return res.status(400).json({
        message: 'معرّف الإشعار غير صالح.',
      });
    }

    const [result] = await pool.query(
      `
        UPDATE notifications
        SET is_read = 1
        WHERE id = ?
          AND recipient_user_id = ?
      `,
      [notificationId, req.user.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: 'الإشعار غير موجود أو لا تملك صلاحية الوصول إليه.',
      });
    }

    return res.status(200).json({
      message: 'تم تعليم الإشعار كمقروء.',
    });
  } catch (error) {
    next(error);
  }
}

async function markAllNotificationsAsRead(req, res, next) {
  try {
    await pool.query(
      `
        UPDATE notifications
        SET is_read = 1
        WHERE recipient_user_id = ?
          AND is_read = 0
      `,
      [req.user.id]
    );

    return res.status(200).json({
      message: 'تم تعليم جميع الإشعارات كمقروءة.',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};