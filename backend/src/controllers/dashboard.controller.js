// HTTP endpoint واحد؛ اختيار الاستعلام المناسب يعتمد على الدور الموثق في middleware.
const dashboards = {
  SUPER_ADMIN: require('../services/dashboard/admin'),
  COURSE_MANAGER: require('../services/dashboard/course-manager'),
  AGENT: require('../services/dashboard/agent'),
  DEPARTMENT_MANAGER: require('../services/dashboard/manager'),
  EMPLOYEE: require('../services/dashboard/employee'),
};

/** يفوض لوحة التحكم إلى خدمة الدور، دون قبول الدور من query أو body. */
function getDashboard(req, res, next) {
  const dashboard = dashboards[req.resourceRole];
  if (!dashboard) return res.status(403).json({ message: 'ليس لديك صلاحية لهذا المورد.' });
  return dashboard.getDashboard(req, res, next);
}

module.exports = { getDashboard };
