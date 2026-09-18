const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const profileUpload = require(
  '../middleware/profile.upload.middleware'
);

const {
  getProfile,
  updateProfile,
} = require('../controllers/employee.profile.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('EMPLOYEE'));

router.get('/', getProfile);

router.patch(
  '/',
  profileUpload.single('passportFile'),
  updateProfile
);

module.exports = router;