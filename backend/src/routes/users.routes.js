const { createScopedRouter } = require('./scoped-router');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/admin.users.validator');
const controllers = {
  SUPER_ADMIN: require('../controllers/admin.users.controller'),
  COURSE_MANAGER: require('../controllers/course-manager.users.controller'),
};

/** يحافظ على validator السوبر أدمن وعلى تحقق مدير الدورة داخل controller الحالي. */
function validateAdmin(schema) {
  const middleware = validate(schema);
  return (req, res, next) => req.resourceRole === 'SUPER_ADMIN'
    ? middleware(req, res, next) : next();
}

module.exports = (legacyRole) => createScopedRouter(controllers, (route) => {
  route('get', '/organization/options', 'getOrganizationOptions');
  route('get', '/', 'getUsers');
  route('post', '/', 'createUser', validateAdmin(schemas.createUserSchema));
  route('get', '/:userId', 'getUserById');
  route('patch', '/:userId', 'updateUser', validateAdmin(schemas.updateUserSchema));
  route('patch', '/:userId/status', 'updateUserStatus', validateAdmin(schemas.statusSchema));
  route('delete', '/:userId', 'softDeleteUser', validateAdmin(schemas.deleteUserSchema));
}, legacyRole);
