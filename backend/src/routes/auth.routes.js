const express = require('express');
const rateLimit = require('express-rate-limit');

const {
  login,
  me,
  logout,
} = require('../controllers/auth.controller');

const { authenticate } = require('../middleware/authenticate');
const { validate } = require('../middleware/validate');
const { loginSchema } = require('../validators/auth.validator');

const router = express.Router();
//حد لعمليات تسجيل الدخول
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  // الطلب الناجح لا يُعد محاولة فاشلة ولا يقلل حصة المستخدم.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'تم تجاوز عدد محاولات تسجيل الدخول. حاول بعد 15 دقيقة.',
  },
});

router.post('/login', loginLimiter, validate(loginSchema), login);
router.get('/me', authenticate, me);
router.post('/logout',logout);

module.exports = router;
