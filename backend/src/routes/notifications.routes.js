const { createScopedRouter } = require('./scoped-router');
const { validate } = require('../middleware/validate');
const { notificationIdSchema, listNotificationsSchema } = require('../validators/notifications.validator');
const notificationController = require('../controllers/notifications.controller');
const controllers = Object.fromEntries(
  ['COURSE_MANAGER', 'AGENT', 'DEPARTMENT_MANAGER', 'EMPLOYEE']
    .map((role) => [role, notificationController])
);

/** تحتفظ الـcontrollers بشرط recipient_user_id في القراءة وتغيير حالة الإشعارات. */
module.exports = () => createScopedRouter(controllers, (route) => {
  route('get', '/', 'listNotifications', validate(listNotificationsSchema, 'query'));
  route('patch', '/read-all', 'markAllNotificationsAsRead');
  route('patch', '/:notificationId/read', 'markNotificationAsRead', validate(notificationIdSchema, 'params'));
});
