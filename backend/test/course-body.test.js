const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCourseBody, validateCourseBody } = require('../src/middleware/course-body');
const { createCourseSchema } = require('../src/validators/admin.courses.validator');

function runMiddleware(middleware, request) {
  let failure;
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { failure = body; return this; },
  };
  let continued = false;
  middleware(request, response, () => { continued = true; });
  return { continued, failure, status: response.statusCode };
}

test('course middleware normalizes multipart fields and validates form metadata', () => {
  const request = { body: {
    courseType: 'TRAINING', status: 'ACTIVE', title: 'دورة تدريبية', totalSeats: '3',
    nominationDeadline: '2026-10-01', allocations: '[{"departmentId":2,"nominationLimit":3}]',
    courseForms: '[{"title":"طلب الالتحاق","dueAt":"2026-10-02","fileIndex":0}]',
  } };
  assert.equal(runMiddleware(normalizeCourseBody, request).continued, true);
  assert.equal(runMiddleware(validateCourseBody(createCourseSchema), request).continued, true);
  assert.equal(request.body.status, 'OPEN_FOR_NOMINATION');
  assert.equal(request.body.totalSeats, 3);
  assert.equal(request.body.courseForms[0].dueAt, '2026-10-02');
  assert.equal(request.body.courseForms[0].isRequired, true);
});

test('legacy courseData payload and malformed arrays have explicit outcomes', () => {
  const legacy = { body: { courseData: JSON.stringify({
    courseType: 'TRAINING', title: 'دورة تدريبية', totalSeats: 2,
    nominationDeadline: '2026-10-01', allocations: [{ department_id: 2, seats: 2 }],
  }) } };
  assert.equal(runMiddleware(normalizeCourseBody, legacy).continued, true);
  assert.equal(runMiddleware(validateCourseBody(createCourseSchema), legacy).continued, true);
  assert.equal(legacy.body.allocations[0].departmentId, 2);
  const invalid = { body: { allocations: '{}' } };
  assert.equal(runMiddleware(normalizeCourseBody, invalid).status, 400);
});
