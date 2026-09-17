const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  listCourses,
  getCourse,
  submitNominations,
  getArchive,
} = require('../controllers/manager.courses.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('DEPARTMENT_MANAGER'));

/*
  يجب أن يكون archive قبل /:courseId.
*/
router.get('/archive', getArchive);

router.get('/', listCourses);

router.get('/:courseId', getCourse);

router.post(
  '/:courseId/nominations',
  express.json(),
  submitNominations
);

module.exports = router;