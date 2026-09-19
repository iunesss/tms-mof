const profileService = require('../services/profile.service');

/** نقطة دخول واحدة لملف الموظف ومدير القسم؛ الخدمة تحدد بيانات القسم من الدور الموثق. */
module.exports = {
  getProfile: profileService.getProfile,
  updateProfile: profileService.updateProfile,
};
