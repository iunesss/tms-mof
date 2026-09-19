const { createScopedRouter } = require('./scoped-router');
const { courseUpload, employeeFormUpload, candidateAttachmentUpload } = require('../middleware/upload.middleware');
const { normalizeCourseBody, validateCourseBody } = require('../middleware/course-body');
const { validate, requireFile } = require('../middleware/validate');
const { createCourseSchema, updateCourseSchema } = require('../validators/admin.courses.validator');
const { directCandidateSchema, candidateStatusSchema, reviewSchema, attachmentSchema,
  submitNominationsSchema, decideNominationsSchema } =
  require('../validators/candidate-actions.validator');
const coursesController = require('../controllers/courses.controller');
// انشاء كائن يحتوي الخمس الرولات وكل رول يحتوي على الفنكشنز الخاصه بالرول فقط
const controllers = Object.fromEntries(
  ['SUPER_ADMIN', 'COURSE_MANAGER', 'AGENT', 'DEPARTMENT_MANAGER', 'EMPLOYEE']
    .map((role) => [role, Object.fromEntries(
      coursesController.allowedOperations[role].map((operation) => [operation, coursesController[operation]])
    )])
);

/**
 * تعريف موحد لمسارات الدورات. العملية غير المتاحة للدور ترفض قبل معالجة الملفات.
 * تظل ملكية الترشيح وقيود القسم والقطاع في controllers الحالية.
 */
module.exports = () => createScopedRouter(controllers, (route) => {
  // استعلامات عامه والخيارات
  route('get', '/organization/options', 'getOrganizationOptions');
  route('get', '/eligible-employees', 'getEligibleEmployees');
  route('get', '/archive', 'getArchive');
  route('get', '/', 'listCourses');
  // انشاء وتعديل الدورات
  route('post', '/', 'createCourse', courseUpload, normalizeCourseBody, validateCourseBody(createCourseSchema));
  route('get', '/:courseId', 'getCourse');
  route('patch', '/:courseId', 'updateCourse', courseUpload, normalizeCourseBody, validateCourseBody(updateCourseSchema));
  route('get', '/:courseId/candidates', 'listCourseCandidates');
  // ادارة الترشيحات والمرشحين
  route('post', '/:courseId/candidates/direct', 'addDirectCandidate', validate(directCandidateSchema));
  route('post', '/:courseId/nominations/:nominationId/select', 'selectNominationCandidate');
  route('post', '/:courseId/nominations', 'submitNominations', validate(submitNominationsSchema));
  route('post', '/:courseId/nominations/decision', 'decideNominations', validate(decideNominationsSchema));
  // استلام النماذج والمستندات
  route('post', '/:courseId/forms/:formId/submission', 'submitForm', employeeFormUpload.single('formFile'));
  // عرض بيانات المرشحين وتحديث حاله المرشح
  route('get', '/:courseId/candidates/:candidateId', 'getCandidate');
  route('patch', '/:courseId/candidates/:candidateId/status', 'updateCandidateStatus', validate(candidateStatusSchema));
  // مراجعة المستندات والنماذج والملفات المرفقة
  route('patch', '/:courseId/candidates/:candidateId/documents/:documentId/review', 'reviewCandidateDocument', validate(reviewSchema));
  route('patch', '/:courseId/candidates/:candidateId/forms/:formId/review', 'reviewCandidateForm', validate(reviewSchema));
  route('patch', '/:courseId/candidates/:candidateId/profile-documents/:profileDocumentId/review', 'reviewProfileDocument', validate(reviewSchema));
  route('post', '/:courseId/candidates/:candidateId/attachments', 'uploadCandidateAttachment',
    candidateAttachmentUpload.single('attachmentFile'), requireFile(), validate(attachmentSchema));
});
