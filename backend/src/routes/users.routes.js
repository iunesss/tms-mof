const { createScopedRouter } = require('./scoped-router');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/admin.users.validator');
const usersController = require('../controllers/users.controller');
const controllers = Object.fromEntries(
  ['SUPER_ADMIN', 'COURSE_MANAGER'].map((role) => [role, Object.fromEntries(
    usersController.allowedOperations[role].map((operation) => [operation, usersController[operation]])
  )])
);

module.exports = () => createScopedRouter(controllers, (route) => {
  route('get', '/organization/options', 'getOrganizationOptions');
  route('get', '/', 'getUsers');
  route('post', '/', 'createUser', validate(schemas.createUserSchema));
  route('get', '/:userId', 'getUserById');
  route('patch', '/:userId', 'updateUser', validate(schemas.updateUserSchema));
  route('patch', '/:userId/status', 'updateUserStatus', validate(schemas.statusSchema));
  route('delete', '/:userId', 'softDeleteUser', validate(schemas.deleteUserSchema));
});
