const express = require('express');
const dashboard = require('./dashboard.routes');
const courses = require('./courses.routes');
const notifications = require('./notifications.routes');
const profile = require('./profile.routes');
const users = require('./users.routes');
const reports = require('./reports.routes');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/dashboard', dashboard());
router.use('/courses', courses());
router.use('/notifications', notifications());
router.use('/profile', profile());
router.use('/users', users());
router.use('/reports', reports);

// مسارات توافق للواجهات الحالية؛ جميعها تستخدم التعريف الموحد نفسه دون إعادة توجيه HTTP.
const legacyResources = {
  admin: { role: 'SUPER_ADMIN', resources: { dashboard, users } },
  'course-manager': { role: 'COURSE_MANAGER', resources: { dashboard, users, notifications } },
  agent: { role: 'AGENT', resources: { dashboard, courses, notifications } },
  manager: { role: 'DEPARTMENT_MANAGER', resources: { dashboard, courses, notifications, profile } },
  employee: { role: 'EMPLOYEE', resources: { dashboard, courses, notifications, profile } },
};
for (const [prefix, { role, resources }] of Object.entries(legacyResources)) {
  for (const [name, createRouter] of Object.entries(resources)) {
    router.use(`/${prefix}/${name}`, createRouter(role));
  }
}
// هذا الرابط مشترك تاريخيًا بين السوبر أدمن ومدير الدورة؛ لا نثبته على دور السوبر أدمن.
router.use('/admin/courses', courses('COURSE_MANAGER'));
router.use('/admin/reports', reports);

module.exports = router;
