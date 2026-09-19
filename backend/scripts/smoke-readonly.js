const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/database');
const app = require('../src/app');

/**
 * فحص قراءة فقط على قاعدة البيانات المحلية: يستعمل حسابًا نشطًا لكل دور.
 * لا ينشئ مستخدمين أو مرشحين ولا يرفع ملفات، ولا يطبع التوكن أو البيانات الشخصية.
 */
async function main() {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  let failures = 0;
  let checks = 0;
  try {
    const [[department]] = await pool.query('SELECT id FROM departments WHERE deleted_at IS NULL ORDER BY id LIMIT 1');
    for (const role of [
      'SUPER_ADMIN', 'COURSE_MANAGER', 'AGENT', 'DEPARTMENT_MANAGER', 'EMPLOYEE',
    ]) {
      const [rows] = await pool.query(
        `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE r.code = ? AND u.is_active = TRUE AND u.deleted_at IS NULL
         AND (? <> 'AGENT' OR EXISTS (
           SELECT 1 FROM sector_agent_assignments a WHERE a.agent_user_id=u.id AND a.end_date IS NULL
         ))
         AND (? <> 'DEPARTMENT_MANAGER' OR EXISTS (
           SELECT 1 FROM department_manager_assignments a WHERE a.manager_user_id=u.id AND a.end_date IS NULL
         )) ORDER BY u.id LIMIT 1`, [role, role, role]
      );
      if (!rows.length) {
        console.log('MISSING TEST ACCOUNT: ' + role);
        failures++;
        continue;
      }
      const token = jwt.sign({ userId: rows[0].id }, process.env.JWT_SECRET, { expiresIn: '5m' });
      const urls = ['/dashboard', '/courses'];
      if (role !== 'SUPER_ADMIN') {
        urls.push('/notifications',
          '/notifications?category=GENERAL&page=1&limit=5',
          '/notifications?readStatus=UNREAD&search=course');
      }
      if (['EMPLOYEE', 'DEPARTMENT_MANAGER'].includes(role)) urls.push('/profile');
      if (['EMPLOYEE', 'DEPARTMENT_MANAGER', 'AGENT'].includes(role)) urls.push('/courses/archive');
      if (['SUPER_ADMIN', 'COURSE_MANAGER'].includes(role)) {
        urls.push('/users', '/courses/organization/options',
          '/courses/eligible-employees?departmentId=' + department.id,
          '/reports/archive', '/reports/archive?page=1&limit=5', '/courses/archive');
      }
      if (role === 'SUPER_ADMIN') urls.push('/reports/audit-logs?page=1&limit=5');
      const base = 'http://127.0.0.1:' + server.address().port + '/api';
      for (const url of urls) {
        const response = await fetch(base + url, { headers: { Cookie: 'tms_token=' + token } });
        const data = await response.json();
        if (url === '/courses' && response.status === 200 && data.courses?.length) {
          const courseId = data.courses[0].id;
          urls.push('/courses/' + courseId);
          if (['SUPER_ADMIN', 'COURSE_MANAGER'].includes(role)) {
            urls.push('/courses/' + courseId + '/candidates');
          }
        }
        if (url.endsWith('/candidates') && data.candidates?.length) {
          urls.push(url + '/' + data.candidates[0].id);
        }
        // حالة 200 وحدها لا تكفي؛ تأكد من أن dispatcher اختار نطاق الدور الصحيح.
        if (url === '/dashboard' && response.status === 200) {
          const scope = {
            AGENT: 'sector', DEPARTMENT_MANAGER: 'department', EMPLOYEE: 'employee',
          }[role];
          if (!data.summary || (scope && !data[scope])) failures++;
        }
        if (url === '/courses' && response.status === 200 && !Array.isArray(data.courses)) failures++;
        if (url === '/notifications' && response.status === 200 && !Array.isArray(data.notifications)) failures++;
        checks++;
        if (response.status !== 200) failures++;
        console.log(role + ' ' + url + ': ' + response.status);
      }
    }
    console.log('Read-only smoke checks: ' + checks + ', failures: ' + failures);
    assert.equal(failures, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message, error.cause?.code || error.cause?.message || '');
  process.exitCode = 1;
});
