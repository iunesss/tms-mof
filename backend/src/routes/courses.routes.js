const { createScopedRouter } = require('./scoped-router');
const { courseUpload, employeeFormUpload, candidateAttachmentUpload } = require('../middleware/upload.middleware');
const { normalizeCourseBody, validateCourseBody } = require('../middleware/course-body');
const { createCourseSchema, updateCourseSchema } = require('../validators/admin.courses.validator');
const admin = require('../controllers/admin.courses.controller');
const employee = require('../controllers/employee.courses.controller');
const administration = {
  ...admin,
  getArchive: require('../controllers/admin.reports.controller').getArchivedCourses,
};
const controllers = {
  SUPER_ADMIN: administration,
  COURSE_MANAGER: administration,
  AGENT: require('../controllers/agent.courses.controller'),
  DEPARTMENT_MANAGER: {
    ...require('../controllers/manager.courses.controller'),
    submitForm: employee.submitForm,
  },
  EMPLOYEE: employee,
};

/**
 * تعريف موحد لمسارات الدورات. العملية غير المتاحة للدور ترفض قبل معالجة الملفات.
 * تظل ملكية الترشيح وقيود القسم والقطاع في controllers الحالية.
 */
module.exports = (legacyRole) => createScopedRouter(controllers, (route) => {
  route('get', '/organization/options', 'getOrganizationOptions');
  route('get', '/eligible-employees', 'getEligibleEmployees');
  route('get', '/archive', 'getArchive');
  route('get', '/', 'listCourses');
  route('post', '/', 'createCourse', courseUpload, normalizeCourseBody, validateCourseBody(createCourseSchema));
  route('get', '/:courseId', 'getCourse');
  route('patch', '/:courseId', 'updateCourse', courseUpload, normalizeCourseBody, validateCourseBody(updateCourseSchema));
  route('get', '/:courseId/candidates', 'listCourseCandidates');
  route('post', '/:courseId/candidates/direct', 'addDirectCandidate');
  route('post', '/:courseId/nominations/:nominationId/select', 'selectNominationCandidate');
  route('post', '/:courseId/nominations', 'submitNominations');
  route('post', '/:courseId/nominations/decision', 'decideNominations');
  route('post', '/:courseId/forms/:formId/submission', 'submitForm', employeeFormUpload.single('formFile'));
  route('get', '/:courseId/candidates/:candidateId', 'getCandidate');
  route('patch', '/:courseId/candidates/:candidateId/status', 'updateCandidateStatus');
  route('patch', '/:courseId/candidates/:candidateId/documents/:documentId/review', 'reviewCandidateDocument');
  route('patch', '/:courseId/candidates/:candidateId/forms/:formId/review', 'reviewCandidateForm');
  route('patch', '/:courseId/candidates/:candidateId/profile-documents/:profileDocumentId/review', 'reviewProfileDocument');
  route('post', '/:courseId/candidates/:candidateId/attachments', 'uploadCandidateAttachment',
    candidateAttachmentUpload.single('attachmentFile'));
}, legacyRole);
