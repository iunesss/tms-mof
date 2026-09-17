const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  getDashboard,
} = require('../controllers/manager.dashboard.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('DEPARTMENT_MANAGER'));

router.get('/', getDashboard);

module.exports = router;