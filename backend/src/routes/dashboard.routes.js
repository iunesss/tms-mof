const { createScopedRouter } = require('./scoped-router');
const controllers = {
  SUPER_ADMIN: require('../controllers/admin.dashboard.controller'),
  COURSE_MANAGER: require('../controllers/course-manager.dashboard.controller'),
  AGENT: require('../controllers/agent.dashboard.controller'),
  DEPARTMENT_MANAGER: require('../controllers/manager.dashboard.controller'),
  EMPLOYEE: require('../controllers/employee.dashboard.controller'),
};

/** /api/dashboard يعرض لوحة دور المستخدم، مع الحفاظ على استعلامات نطاقه الحالية. */
module.exports = (legacyRole) => createScopedRouter(
  controllers, (route) => route('get', '/', 'getDashboard'), legacyRole
);
