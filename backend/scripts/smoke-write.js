// اختبار كتابة اختياري ينشئ سجلات QA دائمة. شغّله فقط مع RUN_WRITE_SMOKE=1.
require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/database');
const app = require('../src/app');

if (process.env.RUN_WRITE_SMOKE !== '1') {
  console.error('Write smoke is disabled. Set RUN_WRITE_SMOKE=1 to leave marked QA records.');
  process.exit(1);
}

const marker = `QA${Date.now()}`;
const password = crypto.randomBytes(18).toString('base64url');
const ids = { marker };
let base;
let server;

function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 33 >>\nstream\nBT /F1 12 Tf 20 100 Td (QA) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([output], { type: 'application/pdf' });
}

async function api(path, { token, method = 'GET', body, form, expected = [200] } = {}) {
  const headers = {};
  if (token) headers.Cookie = `tms_token=${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}/api${path}`, {
    method, headers, body: form || (body && JSON.stringify(body)),
  });
  const data = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path}: ${response.status} ${data.message || ''}`);
  }
  return { data, response };
}

async function createUser(adminToken, roleCode, suffix, assignment) {
  const username = `${marker}_${suffix}`.toLowerCase();
  const { data } = await api('/users', {
    token: adminToken, method: 'POST', expected: [201],
    body: { username, password, roleCode, fullName: `${marker} ${suffix}`,
      employeeNumber: `${marker}-${suffix}`, assignment },
  });
  assert.ok(data.userId);
  ids[suffix] = data.userId;
  const login = await api('/auth/login', {
    method: 'POST', expected: [200], body: { username, password },
  });
  const token = login.response.headers.get('set-cookie')?.match(/tms_token=([^;]+)/)?.[1];
  assert.ok(token, `No login cookie for ${suffix}`);
  console.log(`PASS create/login ${roleCode} id=${data.userId}`);
  return { id: data.userId, token };
}

function courseBody(departmentId, type = 'TRAINING', directEmployeeIds = []) {
  const form = new FormData();
  const fields = {
    courseType: type, title: `${marker} ${type}`, status: type === 'TRAINING' ? 'OPEN_FOR_NOMINATION' : 'ACTIVE',
    description: 'دورة تحقق QA', provider: 'QA', location: 'QA', totalSeats: '2',
    startDate: '2026-10-10', endDate: '2026-10-11', nominationDeadline: '2026-10-01',
    allocations: JSON.stringify([{ departmentId, nominationLimit: 2 }]),
    directEmployeeIds: JSON.stringify(directEmployeeIds),
    courseForms: JSON.stringify(type === 'TRAINING'
      ? [{ title: `${marker} form`, isRequired: true, fileIndex: 0 }] : []),
  };
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (type === 'TRAINING') form.append('courseFormTemplates', pdf(), `${marker}-template.pdf`);
  return form;
}

async function main() {
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    const [[admin]] = await pool.query(`
      SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id
      JOIN roles r ON r.id=ur.role_id WHERE r.code='SUPER_ADMIN'
      AND u.is_active=1 AND u.deleted_at IS NULL LIMIT 1
    `);
    assert.ok(admin, 'No active super admin');
    const adminToken = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

    const courseManager = await createUser(adminToken, 'COURSE_MANAGER', 'cm');
    const agent = await createUser(adminToken, 'AGENT', 'agent', { sectorName: `${marker} sector` });
    const manager = await createUser(adminToken, 'DEPARTMENT_MANAGER', 'manager',
      { agentUserId: agent.id, departmentName: `${marker} department` });
    const employee = await createUser(adminToken, 'EMPLOYEE', 'employee', { managerUserId: manager.id });
    const secondEmployee = await createUser(adminToken, 'EMPLOYEE', 'employee2', { managerUserId: manager.id });
    const [[department]] = await pool.query(
      'SELECT department_id AS id FROM department_manager_assignments WHERE manager_user_id=? AND end_date IS NULL',
      [manager.id]
    );
    assert.ok(department?.id);

    const created = await api('/courses', { token: courseManager.token, method: 'POST',
      form: courseBody(department.id), expected: [201] });
    ids.course = created.data.course.id;
    console.log(`PASS create training course id=${ids.course}`);
    const managerCourses = await api('/courses', { token: manager.token });
    assert.ok(managerCourses.data.courses.some((course) => course.id === ids.course));

    await api(`/courses/${ids.course}/nominations`, { token: manager.token, method: 'POST', expected: [201],
      body: { employeeUserIds: [employee.id, secondEmployee.id] } });
    const [nominations] = await pool.query(
      'SELECT id, nominee_user_id FROM nominations WHERE course_id=? ORDER BY id', [ids.course]
    );
    assert.equal(nominations.length, 2);
    ids.approvedNomination = nominations.find((item) => item.nominee_user_id === employee.id).id;
    ids.rejectedNomination = nominations.find((item) => item.nominee_user_id === secondEmployee.id).id;

    await api(`/courses/${ids.course}/nominations/decision`, { token: agent.token, method: 'POST',
      body: { nominationIds: [ids.approvedNomination], isConfirmed: true } });
    await api(`/courses/${ids.course}/nominations/decision`, { token: agent.token, method: 'POST',
      body: { nominationIds: [ids.rejectedNomination], isConfirmed: false, reason: `${marker} QA rejection` } });
    const nominationsResult = await api(`/courses/${ids.course}/candidates`, { token: courseManager.token });
    assert.ok(nominationsResult.data.approvedNominations.some((item) => item.id === ids.approvedNomination));

    await api(`/courses/${ids.course}/nominations/${ids.approvedNomination}/select`, {
      token: courseManager.token, method: 'POST', expected: [201],
    });
    const candidateResult = await api(`/courses/${ids.course}/candidates`, { token: courseManager.token });
    ids.candidate = candidateResult.data.candidates.find((item) => item.full_name === `${marker} employee`)?.id;
    assert.ok(ids.candidate);

    const courseDetails = await api(`/courses/${ids.course}`, { token: employee.token });
    const courseFormId = courseDetails.data.forms[0]?.id;
    assert.ok(courseFormId);
    const submittedForm = new FormData();
    submittedForm.append('formFile', pdf(), `${marker}-filled.pdf`);
    await api(`/courses/${ids.course}/forms/${courseFormId}/submission`, {
      token: employee.token, method: 'POST', form: submittedForm, expected: [201, 200],
    });

    const profileForm = new FormData();
    profileForm.append('email', `${marker.toLowerCase()}@example.test`);
    profileForm.append('phone', '777000000');
    profileForm.append('jobTitle', 'QA employee');
    profileForm.append('passportFile', pdf(), `${marker}-passport.pdf`);
    await api('/profile', { token: employee.token, method: 'PATCH', form: profileForm });

    const details = await api(`/courses/${ids.course}/candidates/${ids.candidate}`, { token: courseManager.token });
    const submissionId = details.data.candidate.forms[0]?.id;
    const passportId = details.data.candidate.profile_documents.find((doc) => doc.document_type === 'PASSPORT')?.id;
    assert.ok(submissionId && passportId);
    await api(`/courses/${ids.course}/candidates/${ids.candidate}/forms/${submissionId}/review`, {
      token: courseManager.token, method: 'PATCH', body: { decision: 'APPROVED' },
    });
    await api(`/courses/${ids.course}/candidates/${ids.candidate}/profile-documents/${passportId}/review`, {
      token: courseManager.token, method: 'PATCH', body: { decision: 'APPROVED' },
    });
    for (const status of ['PRELIMINARILY_ACCEPTED', 'CONFIRMED']) {
      await api(`/courses/${ids.course}/candidates/${ids.candidate}/status`, {
        token: courseManager.token, method: 'PATCH', body: { status },
      });
    }

    const ticket = new FormData();
    ticket.append('attachmentType', 'TRAVEL_TICKET');
    ticket.append('note', `${marker} ticket`);
    ticket.append('attachmentFile', pdf(), `${marker}-ticket.pdf`);
    await api(`/courses/${ids.course}/candidates/${ids.candidate}/attachments`, {
      token: courseManager.token, method: 'POST', form: ticket, expected: [201],
    });
    const employeeCourse = await api(`/courses/${ids.course}`, { token: employee.token });
    const ticketUrl = employeeCourse.data.candidateAttachments?.find((item) => item.attachment_type === 'TRAVEL_TICKET')?.file_url;
    assert.ok(ticketUrl);
    const file = await fetch(new URL(ticketUrl).pathname.replace(/^/, base), {
      headers: { Cookie: `tms_token=${employee.token}` },
    });
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-type') || '', /pdf/);

    const [[state]] = await pool.query(
      'SELECT n.status AS nomination_status, c.status AS candidate_status FROM nominations n JOIN candidates c ON c.source_nomination_id=n.id WHERE c.id=?',
      [ids.candidate]
    );
    assert.equal(state.candidate_status, 'CONFIRMED');
    const [[audit]] = await pool.query('SELECT COUNT(*) AS total FROM audit_logs WHERE entity_type=? AND entity_id=?',
      ['CANDIDATE', ids.candidate]);
    assert.ok(audit.total > 0);
    const [[notifications]] = await pool.query('SELECT COUNT(*) AS total FROM notifications WHERE recipient_user_id=?', [employee.id]);
    assert.ok(notifications.total > 0);
    console.log('PASS training workflow, uploads, reviews, files, audit and notifications');
    console.log('QA RECORDS:', JSON.stringify(ids));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch((error) => {
  console.error('WRITE SMOKE FAILED:', error.message);
  console.error('QA RECORDS SO FAR:', JSON.stringify(ids));
  process.exitCode = 1;
});
