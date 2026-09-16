const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validate } = require('../middleware/validate');

const {
  createUserSchema,
  updateUserSchema,
  statusSchema,
  deleteUserSchema,
} = require('../validators/admin.users.validator');

const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  softDeleteUser,
  getOrganizationOptions,
} = require('../controllers/admin.users.controller');

const router = express.Router();

// جميع عمليات إدارة المستخدمين للسوبر أدمن فقط
router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

// مهم: يجب أن يكون قبل /:userId
router.get('/organization/options', getOrganizationOptions);

router.get('/', getUsers);
router.post('/', validate(createUserSchema), createUser);

router.get('/:userId', getUserById);
router.patch(
  '/:userId',
  validate(updateUserSchema),
  updateUser
);

router.patch(
  '/:userId/status',
  validate(statusSchema),
  updateUserStatus
);

router.delete(
  '/:userId',
  validate(deleteUserSchema),
  softDeleteUser
);

module.exports = router;