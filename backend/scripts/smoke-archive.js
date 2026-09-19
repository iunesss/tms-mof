// يغيّر دورة QA فقط؛ شغّله يدويًا مع QA_MARKER بعد اختبار الترشيح الذاتي.
require('dotenv').config();
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/database');
const app = require('../src/app');

const marker = process.env.QA_MARKER;
if (!marker?.startsWith('QA')) {
  console.error('Set QA_MARKER to the existing QA fixture marker.');
  process.exit(1);
}

async function main() {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const [[manager]] = await pool.query('SELECT id FROM users WHERE username = ?', [`${marker.toLowerCase()}_cm`]);
    const [[course]] = await pool.query('SELECT id, status FROM courses WHERE title = ?', [`${marker} SELF`]);
    assert.ok(manager && course, 'QA course manager or course missing');
    assert.equal(course.status, 'OPEN_FOR_NOMINATION', 'Use an untouched QA self-nomination course');

    const token = jwt.sign({ userId: manager.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, url, body) => {
      const response = await fetch(base + url, {
        method, body, headers: { Cookie: `tms_token=${token}` },
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    };
    const details = await request('GET', `/api/courses/${course.id}`);
    assert.equal(details.status, 200);
    const existing = details.data.course;
    const payload = (status, report = false) => {
      const form = new FormData();
      const values = {
        courseType: existing.course_type, courseNo: existing.course_no,
        title: existing.title, description: existing.description || '',
        provider: existing.provider || '', location: existing.location || '',
        startDate: String(existing.start_date).slice(0, 10),
        endDate: String(existing.end_date).slice(0, 10),
        nominationDeadline: String(existing.nomination_deadline).slice(0, 10),
        totalSeats: String(existing.total_seats), status,
        allocations: JSON.stringify(existing.allocations.map((allocation) => ({
          departmentId: allocation.department_id,
          nominationLimit: allocation.nomination_limit,
        }))),
        courseForms: '[]', removedCourseFormIds: '[]', directEmployeeIds: '[]',
      };
      for (const [key, value] of Object.entries(values)) form.append(key, value);
      if (report) {
        const bytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
        form.append('finalReport', new Blob([bytes], { type: 'application/pdf' }), `${marker}-final-report.pdf`);
      }
      return form;
    };
    const endpoint = `/api/courses/${course.id}`;
    assert.equal((await request('PATCH', endpoint, payload('ARCHIVED', true))).status, 400);
    assert.equal((await request('PATCH', endpoint, payload('COMPLETED'))).status, 200);
    const withoutReport = await request('PATCH', endpoint, payload('ARCHIVED'));
    assert.equal(withoutReport.status, 400);
    assert.match(withoutReport.data.message, /التقرير/);
    assert.equal((await request('PATCH', endpoint, payload('ARCHIVED', true))).status, 200);
    const archived = await request('GET', endpoint);
    assert.equal(archived.data.course.status, 'ARCHIVED');
    assert.ok(archived.data.course.final_report?.file_url);
    const fileResponse = await fetch(base + new URL(archived.data.course.final_report.file_url).pathname, {
      headers: { Cookie: `tms_token=${token}` },
    });
    assert.equal(fileResponse.status, 200);
    assert.equal((await request('PATCH', endpoint, payload('ACTIVE'))).status, 400);
    const [[saved]] = await pool.query(
      `SELECT c.status, COUNT(r.id) AS reports FROM courses c
       JOIN course_reports r ON r.course_id = c.id AND r.deleted_at IS NULL
       WHERE c.id = ? GROUP BY c.id`, [course.id]
    );
    assert.equal(saved.status, 'ARCHIVED');
    assert.equal(saved.reports, 1);
    console.log(`PASS archive lifecycle, required report, protected report download. marker=${marker} course=${course.id}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch((error) => { console.error('ARCHIVE SMOKE FAILED:', error.message); process.exitCode = 1; });
