const { createScopedRouter } = require('./scoped-router');
const { profileUpload } = require('../middleware/upload.middleware');
const controllers = {
  DEPARTMENT_MANAGER: require('../controllers/manager.profile.controller'),
  EMPLOYEE: require('../controllers/employee.profile.controller'),
};

/** الملف الشخصي مبني على req.user.id؛ لا يقبل هوية بديلة من المتصفح. */
module.exports = (legacyRole) => createScopedRouter(controllers, (route) => {
  route('get', '/', 'getProfile');
  route('patch', '/', 'updateProfile', profileUpload.single('passportFile'));
}, legacyRole);
