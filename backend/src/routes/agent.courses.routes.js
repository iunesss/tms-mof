const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  listCourses,
  getCourse,
  decideNominations,
  getArchive,
} = require('../controllers/agent.courses.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('AGENT'));

router.get('/archive', getArchive);

router.get('/', listCourses);

router.get('/:courseId', getCourse);

router.post(
  '/:courseId/nominations/decision',
  express.json(),
  decideNominations
);

module.exports = router;