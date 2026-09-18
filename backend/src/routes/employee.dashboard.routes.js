const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  getDashboard,
} = require('../controllers/employee.dashboard.controller');

const router = express.Router();

/*
  جميع مسارات Employee Dashboard
  تحتاج تسجيل دخول وصلاحية EMPLOYEE.
*/
router.use(authenticate);
router.use(authorize('EMPLOYEE'));

router.get('/', getDashboard);

module.exports = router;