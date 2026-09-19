const admin = require('../services/users/admin');
const courseManager = require('../services/users/course-manager');

// قائمة عمليات واحدة؛ كل وظيفة تختار خدمة الدور الموثق ولا تقبل الدور من الطلب.
const operations = [
  'getOrganizationOptions', 'getUsers', 'createUser', 'getUserById',
  'updateUser', 'updateUserStatus', 'softDeleteUser',
];
const handlers = { SUPER_ADMIN: admin, COURSE_MANAGER: courseManager };
const controller = {};
for (const operation of operations) {
  controller[operation] = (req, res, next) => {
    const handler = handlers[req.resourceRole]?.[operation];
    if (!handler) return res.status(403).json({ message: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
    return handler(req, res, next);
  };
}

controller.allowedOperations = Object.fromEntries(
  Object.entries(handlers).map(([role, service]) => [role, Object.keys(service)])
);
module.exports = controller;
