const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  getAuditLogs,
  getAuditEventTypes,
  getArchivedCourses,
} = require('../controllers/admin.reports.controller');

// راوت التقارير الموحد؛ يبقى التدقيق للسوبر أدمن والأرشيف للإدارة.
const router = express.Router();

router.use(authenticate);

/*
  سجل التدقيق خاص بالسوبر أدمن فقط.
*/
router.get(
  '/audit-logs/event-types',
  authorize('SUPER_ADMIN'),
  getAuditEventTypes
);

router.get(
  '/audit-logs',
  authorize('SUPER_ADMIN'),
  getAuditLogs
);

/*
  أرشيف الدورات متاح للسوبر أدمن ومدير الدورة.
*/
router.get(
  '/archive',
  authorize('SUPER_ADMIN', 'COURSE_MANAGER'),
  getArchivedCourses
);

module.exports = router;
