const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  getUsers,
  getUserById,
  getOrganizationOptions,
  createUser,
  updateUser,
  updateUserStatus,
} = require('../controllers/course-manager.users.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('COURSE_MANAGER'));

router.get('/organization/options', getOrganizationOptions);

router.get('/', getUsers);

router.post('/', createUser);

router.get('/:userId', getUserById);

router.patch('/:userId', updateUser);

router.patch('/:userId/status', updateUserStatus);

module.exports = router;