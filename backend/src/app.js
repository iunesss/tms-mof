const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { authenticate } = require('./middleware/authenticate');
const { serveAuthorizedFile } = require('./middleware/file-access');
const { errorHandler, notFound } = require('./middleware/error-handler');
const apiRoutes = require('./routes');

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// الرابط ثابت للواجهات، لكن كل تنزيل يحتاج تسجيل دخول وصلاحية على المستند.
app.use('/uploads', authenticate, serveAuthorizedFile);
app.get('/api/health', (req, res) => {
  res.json({ message: 'TMS API is running.' });
});
app.use('/api', apiRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
