const { createScopedRouter } = require('./scoped-router');
const controllers = {
  COURSE_MANAGER: require('../controllers/course-manager.notifications.controller'),
  AGENT: require('../controllers/agent.notifications.controller'),
  DEPARTMENT_MANAGER: require('../controllers/manager.notifications.controller'),
  EMPLOYEE: require('../controllers/employee.notifications.controller'),
};

/** تحتفظ الـcontrollers بشرط recipient_user_id في القراءة وتغيير حالة الإشعارات. */
module.exports = (legacyRole) => createScopedRouter(controllers, (route) => {
  route('get', '/', 'listNotifications');
  route('patch', '/read-all', 'markAllNotificationsAsRead');
  route('patch', '/:notificationId/read', 'markNotificationAsRead');
}, legacyRole);
