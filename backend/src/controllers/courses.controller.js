const admin = require('../services/courses/admin');
const agent = require('../services/courses/agent');
const manager = require('../services/courses/manager');
const employee = require('../services/courses/employee');
const { getArchivedCourses } = require('./reports.controller');

// العمليات المشتركة تُوجّه حسب الدور الذي أثبته authenticate، لا حسب حقول الطلب.
const services = {
  SUPER_ADMIN: { ...admin, getArchive: getArchivedCourses },
  COURSE_MANAGER: { ...admin, getArchive: getArchivedCourses },
  AGENT: agent,
  DEPARTMENT_MANAGER: { ...manager, submitForm: employee.submitForm },
  EMPLOYEE: employee,
};
const operations = [
  'getOrganizationOptions', 'getEligibleEmployees', 'getArchive', 'listCourses',
  'createCourse', 'getCourse', 'updateCourse', 'listCourseCandidates',
  'addDirectCandidate', 'selectNominationCandidate', 'submitNominations',
  'decideNominations', 'submitForm', 'getCandidate', 'updateCandidateStatus',
  'reviewCandidateDocument', 'reviewCandidateForm', 'reviewProfileDocument',
  'uploadCandidateAttachment',
];
const controller = {};
for (const operation of operations) {
  controller[operation] = (req, res, next) => {
    const handler = services[req.resourceRole]?.[operation];
    if (!handler) return res.status(403).json({ message: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
    return handler(req, res, next);
  };
}

// يستخدمها الـrouter لمنع تشغيل multer/validator لعملية غير متاحة لهذا الدور.
controller.allowedOperations = Object.fromEntries(
  Object.entries(services).map(([role, service]) => [role, Object.keys(service)])
);
module.exports = controller;
