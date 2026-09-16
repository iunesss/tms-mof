const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  getDashboard,
} = require('../controllers/course-manager.dashboard.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('COURSE_MANAGER'));

router.get('/', getDashboard);

module.exports = router;