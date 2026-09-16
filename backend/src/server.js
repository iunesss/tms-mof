require('dotenv').config();

const app = require('./app');
const pool = require('./config/database');

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  try {
    //اختبار اتصال تجريبي بقاعده البيانات
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();

    console.log('MySQL connected successfully.');
//يبدا الاتصال الفعلي بقاعده البيانات
    app.listen(PORT, () => {
      console.log(`TMS API running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Server failed to start:', error.message);
    process.exit(1);
  }
}
//تشغبل السيرفر
startServer();