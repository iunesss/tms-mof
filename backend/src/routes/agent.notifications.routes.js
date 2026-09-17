const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  listNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} = require('../controllers/agent.notifications.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorize('AGENT'));

router.get('/', listNotifications);

router.patch(
  '/read-all',
  markAllNotificationsAsRead
);

router.patch(
  '/:notificationId/read',
  markNotificationAsRead
);

module.exports = router;