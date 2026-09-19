const express = require('express');
const dashboard = require('./dashboard.routes');
const courses = require('./courses.routes');
const notifications = require('./notifications.routes');
const profile = require('./profile.routes');
const users = require('./users.routes');
const reports = require('./reports.routes');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/dashboard', dashboard());
router.use('/courses', courses());
router.use('/notifications', notifications());
router.use('/profile', profile());
router.use('/users', users());
router.use('/reports', reports);

module.exports = router;
