// يختبر المهمة المباشرة باستعمال حسابات QA التي أنشأها smoke-write.js.
require('dotenv').config();
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/database');
const app = require('../src/app');

const marker = process.env.QA_MARKER;
if (!marker?.startsWith('QA')) {
  console.error('Set QA_MARKER to an existing QA marker. This creates a persistent QA mission.');
  process.exit(1);
}

async function main() {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const [users] = await pool.query('SELECT id, username FROM users WHERE username LIKE ?', [`${marker.toLowerCase()}_%`]);
    const id = (suffix) => users.find((user) => user.username === `${marker.toLowerCase()}_${suffix}`)?.id;
    const cm = id('cm');
    const agent = id('agent');
    const manager = id('manager');
    const employee = id('employee2');
    assert.ok(cm && agent && manager && employee, 'QA accounts not found');
    const token = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const [[department]] = await pool.query(
      'SELECT department_id AS id FROM department_manager_assignments WHERE manager_user_id=? AND end_date IS NULL', [manager]
    );
    const request = async (path, userId, options = {}) => {
      const response = await fetch(base + path, {
        ...options, headers: { Cookie: `tms_token=${token(userId)}`, ...options.headers },
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    };
    const form = new FormData();
    const fields = {
      courseType: 'MISSION', title: `${marker} MISSION`, status: 'ACTIVE',
      totalSeats: '1', startDate: '2026-10-12', endDate: '2026-10-13',
      allocations: JSON.stringify([{ departmentId: department.id, nominationLimit: 1 }]),
      directEmployeeIds: JSON.stringify([employee]),
    };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const created = await request('/courses', cm, { method: 'POST', body: form });
    assert.equal(created.status, 201, created.data.message);
    const courseId = created.data.course.id;
    const employeeCourse = await request(`/courses/${courseId}`, employee);
    assert.equal(employeeCourse.status, 200, employeeCourse.data.message);
    const managerCourse = await request(`/courses/${courseId}`, manager);
    assert.equal(managerCourse.status, 200, managerCourse.data.message);
    assert.equal(managerCourse.data.read_only, true);
    const agentCourse = await request(`/courses/${courseId}`, agent);
    assert.equal(agentCourse.status, 200, agentCourse.data.message);
    const blocked = await request(`/courses/${courseId}/nominations`, manager, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeUserIds: [employee] }),
    });
    assert.equal(blocked.status, 400);
    const [[candidate]] = await pool.query('SELECT id, status FROM candidates WHERE course_id=? AND employee_user_id=?',
      [courseId, employee]);
    assert.ok(candidate);
    console.log(`PASS mission direct candidate, employee access, manager/agent visibility, nomination blocked. marker=${marker} mission=${courseId} candidate=${candidate.id}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch((error) => { console.error('MISSION SMOKE FAILED:', error.message); process.exitCode = 1; });
