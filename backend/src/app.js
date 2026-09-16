const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const authRoutes = require('./routes/auth.routes');
const adminDashboardRoutes = require('./routes/admin.dashboard.routes');
const adminUsersRoutes = require('./routes/admin.users.routes');
const adminCoursesRoutes = require('./routes/admin.courses.routes');
const adminReportsRoutes = require('./routes/admin.reports.routes');
const courseManagerDashboardRoutes = require('./routes/course-manager.dashboard.routes');
const courseManagerNotificationsRoutes = require('./routes/course-manager.notifications.routes'
);


const app = express();

app.use(helmet({
  crossOriginResourcePolicy: false,
}));

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(
  '/uploads',
  express.static(path.join(__dirname, '../public/uploads'))
);

app.get('/api/health', (req, res) => {
  res.status(200).json({
    message: 'TMS API is running.',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/admin/courses', adminCoursesRoutes);
app.use('/api/admin/reports', adminReportsRoutes);
app.use('/api/course-manager/dashboard', courseManagerDashboardRoutes);
app.use('/api/course-manager/notifications',courseManagerNotificationsRoutes);
app.use((req, res) => {
  res.status(404).json({
    message: 'المسار المطلوب غير موجود.',
  });
});

app.use((error, req, res, next) => {
  console.error('Server error:', error);

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: 'حجم الملف أكبر من الحد المسموح: 10 MB.',
      });
    }

    return res.status(400).json({
      message: 'حدث خطأ أثناء رفع الملف.',
    });
  }

  if (error.message?.includes('نوع الملف غير مسموح')) {
    return res.status(400).json({
      message: error.message,
    });
  }

  return res.status(500).json({
    message: 'حدث خطأ داخلي في الخادم.',
  });
});

module.exports = app;