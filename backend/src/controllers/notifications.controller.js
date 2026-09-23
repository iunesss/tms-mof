const pool = require('../config/database');

// تختلف تسمية التصنيف في الواجهة القديمة لكل دور؛ تبقى البيانات والاستعلام موحدين.
const CATEGORY_TERMS = {
  COURSE_MANAGER: { DOCUMENTS: ['DOCUMENT', 'FORM'], CANDIDATES: ['CANDIDATE', 'NOMINATION'], COURSES: ['COURSE', 'MISSION', 'INVITATION'] },
  AGENT: { DOCUMENTS: ['DOCUMENT', 'FORM'], NOMINATIONS: ['NOMINATION', 'CANDIDATE'], COURSES: ['COURSE', 'MISSION', 'INVITATION'] },
  DEPARTMENT_MANAGER: { DOCUMENTS: ['DOCUMENT', 'FORM'], NOMINATIONS: ['NOMINATION', 'CANDIDATE'], COURSES: ['COURSE', 'MISSION', 'INVITATION'] },
  EMPLOYEE: { FORMS: ['FORM', 'DOCUMENT', 'SUBMISSION'], COURSES: ['COURSE', 'MISSION', 'CANDIDATE', 'NOMINATION', 'INVITATION'] },
};

/** يصنف نوع الإشعار بنفس أولوية الواجهة الخاصة بالدور. */
function categoryOf(type, role) {
  const normalized = String(type || '').toUpperCase();
  for (const [category, terms] of Object.entries(CATEGORY_TERMS[role])) {
    if (terms.some((term) => normalized.includes(term))) return category;
  }
  return 'GENERAL';
}

/** يبني SQL من قائمة كلمات ثابتة، ويقيد كل الاستعلامات بهوية المستلم. */
function filters(query, userId, role) {
  const conditions = ['n.recipient_user_id = ?'];
  const values = [userId];
  const groups = CATEGORY_TERMS[role];
  const category = query.category;
  if (category === 'GENERAL') {
    const terms = [...new Set(Object.values(groups).flat())];
    conditions.push(`(${terms.map((term) => `n.notification_type NOT LIKE '%${term}%'`).join(' AND ')})`);
  } else if (groups[category]) {
    conditions.push(`(${groups[category].map((term) => `n.notification_type LIKE '%${term}%'`).join(' OR ')})`);
  }
  if (query.readStatus === 'READ') conditions.push('n.is_read = TRUE');
  if (query.readStatus === 'UNREAD') conditions.push('n.is_read = FALSE');
  if (query.search) {
    const fields = role === 'AGENT' || role === 'COURSE_MANAGER'
      ? ['n.title', 'n.message', 'n.notification_type'] : ['n.title', 'n.message'];
    conditions.push(`(${fields.map((field) => `${field} LIKE ?`).join(' OR ')})`);
    values.push(...fields.map(() => `%${query.search}%`));
  }
  return { where: conditions.join(' AND '), values };
}

/** يعرض إشعارات المستخدم نفسه فقط؛ الاختلافات القديمة في التصنيف محفوظة. */
async function listNotifications(req, res, next) {
  try {
    const role = req.resourceRole;
    const query = req.validatedQuery;
    const page = query.page;
    const limit = query.limit || (role === 'DEPARTMENT_MANAGER' || role === 'EMPLOYEE' ? 10 : 12);
    const { where, values } = filters(query, req.user.id, role);
    const [countResult, unreadResult, rowsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM notifications n WHERE ${where}`, values),
      pool.query('SELECT COUNT(*) AS total FROM notifications WHERE recipient_user_id = ? AND is_read = FALSE', [req.user.id]),
      pool.query(`SELECT n.id, n.notification_type, n.title, n.message,
          n.related_entity_type, n.related_entity_id, n.is_read, n.read_at, n.created_at,
          sender.username AS sender_username, profile.full_name AS sender_full_name
        FROM notifications n LEFT JOIN users sender ON sender.id = n.sender_user_id
        LEFT JOIN user_profiles profile ON profile.user_id = sender.id
        WHERE ${where} ORDER BY n.is_read ASC, n.created_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, (page - 1) * limit]),
    ]);
    const count = countResult[0][0];
    const unread = unreadResult[0][0];
    const rows = rowsResult[0];
    const total = Number(count.total || 0);
    res.json({
      unreadCount: Number(unread.total || 0),
      notifications: rows.map((row) => ({
        ...row, is_read: Boolean(row.is_read), category: categoryOf(row.notification_type, role),
        sender_name: row.sender_full_name || row.sender_username || 'النظام',
      })),
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    });
  } catch (error) { next(error); }
}

/** يعلّم إشعارًا واحدًا كمقروء بشرط أن يكون للمستخدم الحالي. */
async function markNotificationAsRead(req, res, next) {
  try {
    const [result] = await pool.query(
      `UPDATE notifications SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND recipient_user_id = ?`,
      [req.params.notificationId, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'الإشعار غير موجود أو لا تملك صلاحية الوصول إليه.' });
    res.json({ message: 'تم تعليم الإشعار كمقروء.' });
  } catch (error) { next(error); }
}

/** يعلّم جميع إشعارات المستخدم الحالي كمقروءة دون التأثير في مستخدم آخر. */
async function markAllNotificationsAsRead(req, res, next) {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
       WHERE recipient_user_id = ? AND is_read = FALSE`, [req.user.id]
    );
    res.json({ message: 'تم تعليم جميع الإشعارات كمقروءة.' });
  } catch (error) { next(error); }
}

module.exports = { listNotifications, markNotificationAsRead, markAllNotificationsAsRead };
