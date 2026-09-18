const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const employeeFormUpload = require(
  '../middleware/employee.form-upload.middleware'
);

const {
  listCourses,
  getArchive,
  getCourse,
  submitForm,
} = require('../controllers/employee.courses.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('EMPLOYEE'));

router.get('/', listCourses);

router.get('/archive', getArchive);

router.get('/:courseId', getCourse);

router.post(
  '/:courseId/forms/:formId/submission',
  employeeFormUpload.single('formFile'),
  submitForm
);

module.exports = router;