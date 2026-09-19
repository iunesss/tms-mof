const { createScopedRouter } = require('./scoped-router');
const dashboardController = require('../controllers/dashboard.controller');
const controllers = Object.fromEntries(
  ['SUPER_ADMIN', 'COURSE_MANAGER', 'AGENT', 'DEPARTMENT_MANAGER', 'EMPLOYEE']
    .map((role) => [role, dashboardController])
);

/** /api/dashboard يعرض لوحة دور المستخدم، مع الحفاظ على استعلامات نطاقه الحالية. */
module.exports = () => createScopedRouter(
  controllers, (route) => route('get', '/', 'getDashboard')
);
