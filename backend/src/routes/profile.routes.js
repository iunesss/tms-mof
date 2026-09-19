const { createScopedRouter } = require('./scoped-router');
const { profileUpload } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validate');
const { updateProfileSchema } = require('../validators/profile.validator');
const profileController = require('../controllers/profile.controller');
// ينشئ كائن يسمح بمدير او مظف فقط لانهم الوحيدين الي عندهم بروفايل
const controllers = { DEPARTMENT_MANAGER: profileController, EMPLOYEE: profileController };

/** الملف الشخصي مبني على req.user.id؛ لا يقبل هوية بديلة من المتصفح. */
module.exports = () => createScopedRouter(controllers, (route) => {
  route('get', '/', 'getProfile');
  route('patch', '/', 'updateProfile', profileUpload.single('passportFile'), validate(updateProfileSchema));
});
