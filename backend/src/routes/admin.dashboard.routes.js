const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const {
  getDashboard,
} = require('../controllers/admin.dashboard.controller');

const router = express.Router();

router.get(
  '/',
  authenticate,
  authorize('SUPER_ADMIN'),
  getDashboard
);

module.exports = router;