const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

// ترتيب صريح للحسابات متعددة الأدوار؛ لا يقبل اختيار الدور من query أو body.
const ROLE_PRIORITY = ['SUPER_ADMIN', 'COURSE_MANAGER', 'AGENT', 'DEPARTMENT_MANAGER', 'EMPLOYEE'];

/**
 * يبني راوت مورد واحد، ويختار controller من أدوار الحساب التي تحقق منها authenticate.
 * legacyRole يحافظ على سلوك الروابط القديمة، بعد فحص صلاحية الوصول إليها.
 * هذا التوجيه لا يستبدل شروط ملكية السجل والقسم والقطاع داخل الـcontrollers.
 */
function createScopedRouter(controllers, configure, legacyRole) {
  const router = express.Router();
  router.use(authenticate);
  if (legacyRole) router.use(authorize(legacyRole));
  router.use((req, res, next) => {
    req.resourceRole = legacyRole || ROLE_PRIORITY.find(
      (role) => req.user.roles.includes(role) && controllers[role]
    );
    if (!controllers[req.resourceRole]) {
      return res.status(403).json({ message: 'ليس لديك صلاحية لهذا المورد.' });
    }
    next();
  });

  /** يسجل العملية مرة واحدة ويتحقق من توفرها للدور قبل تشغيل الرفع أو الـvalidator. */
  function route(method, path, action, ...middleware) {
    router[method](path, (req, res, next) => {
      if (typeof controllers[req.resourceRole][action] !== 'function') {
        return res.status(403).json({ message: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
      }
      next();
    }, ...middleware, (req, res, next) => controllers[req.resourceRole][action](req, res, next));
  }
  configure(route);
  return router;
}

module.exports = { createScopedRouter, ROLE_PRIORITY };
