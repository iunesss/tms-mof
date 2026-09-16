const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { courseUpload } = require('../middleware/upload.middleware');

const {
  listCourses,
  getOrganizationOptions,
  getEligibleEmployees,
  createCourse,
  getCourse,
  updateCourse,
  listCourseCandidates,
  addDirectCandidate,
  getCandidate,
  updateCandidateStatus,
  reviewCandidateDocument,
} = require('../controllers/admin.courses.controller');

const {
  createCourseSchema,
  updateCourseSchema,
} = require('../validators/admin.courses.validator');

const router = express.Router();

/*
  يحول Arrays القادمة من FormData إلى Arrays حقيقية.
*/
function normalizeCourseBody(req, res, next) {
  try {
    const parseJsonArray = (value, fieldName) => {
      if (value === undefined || value === null || value === '') {
        return [];
      }

      if (Array.isArray(value)) {
        return value;
      }

      if (typeof value === 'string') {
        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
          throw new Error(`${fieldName} يجب أن يكون قائمة.`);
        }

        return parsed;
      }

      throw new Error(`${fieldName} غير صالح.`);
    };

    req.body.allocations = parseJsonArray(
      req.body.allocations,
      'بيانات الأقسام'
    );

    req.body.directEmployeeIds = parseJsonArray(
      req.body.directEmployeeIds,
      'بيانات الموظفين'
    );

    req.body.courseForms = parseJsonArray(
      req.body.courseForms,
      'بيانات الاستمارات'
    );

    req.body.removedCourseFormIds = parseJsonArray(
      req.body.removedCourseFormIds,
      'بيانات الاستمارات المحذوفة'
    );

    return next();
  } catch (error) {
    return res.status(400).json({
      message: error.message || 'البيانات المرسلة غير صالحة.',
    });
  }
}

/*
  التحقق من حقول الدورة عبر Zod.
  مهم: لا نستبدل req.body كليًا حتى لا نفقد courseForms
  و removedCourseFormIds قبل وصولها إلى الـController.
*/
function validateBody(schema) {
  return (req, res, next) => {
    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message:
          validation.error.issues[0]?.message ||
          'بيانات الدورة غير صالحة.',
        errors: validation.error.issues,
      });
    }

    req.body = {
      ...req.body,
      ...validation.data,
    };

    return next();
  };
}

/*
  الدورات مشتركة بين:
  - Super Admin
  - Course Manager

  يشمل هذا:
  إنشاء وتعديل الدورات، المرشحين، المستندات،
  تفاصيل المرشح، وتفاصيل الموظف من الأرشيف.
*/
router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'COURSE_MANAGER'));

/*
  يجب أن تبقى هذه المسارات قبل /:courseId.
*/
router.get('/organization/options', getOrganizationOptions);

router.get('/eligible-employees', getEligibleEmployees);

/* الدورات */
router.get('/', listCourses);

router.post(
  '/',
  courseUpload,
  normalizeCourseBody,
  validateBody(createCourseSchema),
  createCourse
);

router.get('/:courseId', getCourse);

router.patch(
  '/:courseId',
  courseUpload,
  normalizeCourseBody,
  validateBody(updateCourseSchema),
  updateCourse
);

/* المرشحون */
router.get('/:courseId/candidates', listCourseCandidates);

router.post(
  '/:courseId/candidates/direct',
  addDirectCandidate
);

router.get(
  '/:courseId/candidates/:candidateId',
  getCandidate
);

router.patch(
  '/:courseId/candidates/:candidateId/status',
  updateCandidateStatus
);

router.patch(
  '/:courseId/candidates/:candidateId/documents/:documentId/review',
  reviewCandidateDocument
);

module.exports = router;