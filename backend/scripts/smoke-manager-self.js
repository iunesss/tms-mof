// يختبر ترشيح مدير القسم لنفسه ورفع استمارته، باستعمال حسابات QA الموجودة.
require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/database');
const app = require('../src/app');

const marker = process.env.QA_MARKER;
if (!marker?.startsWith('QA')) {
  console.error('Set QA_MARKER to an existing QA marker. This creates a persistent QA course.');
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
    assert.ok(cm && agent && manager, 'QA accounts not found');
    const [[department]] = await pool.query(
      'SELECT department_id AS id FROM department_manager_assignments WHERE manager_user_id=? AND end_date IS NULL', [manager]
    );
    const [[template]] = await pool.query(`
      SELECT f.storage_key FROM course_forms cf JOIN files f ON f.id=cf.template_file_id
      JOIN courses c ON c.id=cf.course_id WHERE c.title=? LIMIT 1
    `, [`${marker} TRAINING`]);
    assert.match(template?.storage_key || '', /^courses\/[\w-]+\.pdf$/);
    const pdf = fs.readFileSync(path.join(__dirname, '../public/uploads', template.storage_key));
    const token = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const request = async (url, userId, options = {}) => {
      const response = await fetch(base + url, {
        ...options, headers: { Cookie: `tms_token=${token(userId)}`, ...options.headers },
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    };

    const form = new FormData();
    const fields = {
      courseType: 'TRAINING', title: `${marker} SELF`, status: 'OPEN_FOR_NOMINATION',
      totalSeats: '1', startDate: '2026-10-14', endDate: '2026-10-15',
      nominationDeadline: '2026-10-01',
      allocations: JSON.stringify([{ departmentId: department.id, nominationLimit: 1 }]),
      courseForms: JSON.stringify([{ title: `${marker} self form`, isRequired: true, fileIndex: 0 }]),
    };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('courseFormTemplates', new Blob([pdf], { type: 'application/pdf' }), `${marker}-self-template.pdf`);
    const created = await request('/courses', cm, { method: 'POST', body: form });
    assert.equal(created.status, 201, created.data.message);
    const courseId = created.data.course.id;
    const submitted = await request(`/courses/${courseId}/nominations`, manager, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeUserIds: [manager] }),
    });
    assert.equal(submitted.status, 201, submitted.data.message);
    const [[nomination]] = await pool.query('SELECT id FROM nominations WHERE course_id=? AND nominee_user_id=?',
      [courseId, manager]);
    assert.ok(nomination);
    const decided = await request(`/courses/${courseId}/nominations/decision`, agent, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nominationIds: [nomination.id], isConfirmed: true }),
    });
    assert.equal(decided.status, 200, decided.data.message);
    const selected = await request(`/courses/${courseId}/nominations/${nomination.id}/select`, cm, { method: 'POST' });
    assert.equal(selected.status, 201, selected.data.message);
    const details = await request(`/courses/${courseId}`, manager);
    assert.equal(details.status, 200, details.data.message);
    assert.equal(details.data.selfCandidate, true);
    const formId = details.data.selfCourseForms?.[0]?.id;
    assert.ok(formId, 'Manager form missing');
    const submission = new FormData();
    submission.append('formFile', new Blob([pdf], { type: 'application/pdf' }), `${marker}-self-filled.pdf`);
    const uploaded = await request(`/courses/${courseId}/forms/${formId}/submission`, manager, {
      method: 'POST', body: submission,
    });
    assert.ok([200, 201].includes(uploaded.status), uploaded.data.message);
    const [[candidate]] = await pool.query('SELECT id FROM candidates WHERE course_id=? AND employee_user_id=?',
      [courseId, manager]);
    const [[saved]] = await pool.query('SELECT status, current_version_no FROM candidate_form_submissions WHERE candidate_id=? AND course_form_id=?',
      [candidate.id, formId]);
    assert.ok(saved.current_version_no > 0);
    console.log(`PASS manager self-nomination, agent approval, committee selection and form upload. marker=${marker} course=${courseId} candidate=${candidate.id}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch((error) => { console.error('SELF SMOKE FAILED:', error.message); process.exitCode = 1; });
