const express = require('express');
const { authenticate } = require('../middleware/authenticate');

// ترتيب صريح للحسابات متعددة الأدوار؛ لا يقبل اختيار الدور من query أو body.
const ROLE_PRIORITY = ['SUPER_ADMIN', 'COURSE_MANAGER', 'AGENT', 'DEPARTMENT_MANAGER', 'EMPLOYEE'];

/**
 * يبني راوت مورد واحد، ويختار controller من أدوار الحساب التي تحقق منها authenticate.
 * هذا التوجيه لا يستبدل شروط ملكية السجل والقسم والقطاع داخل الـcontrollers.
 */
function createScopedRouter(controllers, configure) {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    req.resourceRole = ROLE_PRIORITY.find(
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
      // يتاكد من ملف الكنترولر هل الرول حق المستخدم له صلاحيه للفنكشن او العمليه الفلانيه قبل ما يسوي فاليديت او يشغل ميدل يور
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
