const test = require('node:test');
const assert = require('node:assert/strict');
const { createCourseSchema } = require('../src/validators/admin.courses.validator');
const { writeAuditLog } = require('../src/utils/audit');
const { createNotification } = require('../src/utils/notifications');
const { directCandidateSchema, reviewSchema, decideNominationsSchema } =
  require('../src/validators/candidate-actions.validator');
const { updateProfileSchema } = require('../src/validators/profile.validator');

const training = {
  courseType: 'TRAINING', title: 'دورة اختبار', totalSeats: 2,
  nominationDeadline: '2026-10-01', allocations: [{ departmentId: 1, nominationLimit: 2 }],
};

test('course validator rejects a malformed employee list instead of silently dropping it', () => {
  assert.equal(createCourseSchema.safeParse({ ...training, directEmployeeIds: '1,2' }).success, false);
  assert.equal(createCourseSchema.safeParse(training).success, true);
});

test('audit and notification utilities reject missing required fields before SQL', async () => {
  let calls = 0;
  const connection = { query: async () => { calls += 1; } };
  await assert.rejects(writeAuditLog(connection, { eventType: 'TEST', entityType: 'COURSE' }), TypeError);
  await assert.rejects(createNotification(connection, { recipientUserId: 1, title: 'عنوان' }), TypeError);
  assert.equal(calls, 0);
});

test('valid audit and notification payloads use the provided transaction connection', async () => {
  const statements = [];
  const connection = { query: async (sql, parameters) => { statements.push({ sql, parameters }); } };
  await writeAuditLog(connection, { actorUserId: 1, eventType: 'TEST', entityType: 'COURSE', entityId: 2 });
  await createNotification(connection, {
    recipientUserId: 2, notificationType: 'TEST', title: 'عنوان', message: 'رسالة',
  });
  assert.equal(statements.length, 2);
  assert.equal(statements[0].parameters[1], 'TEST');
  assert.equal(statements[1].parameters[0], 2);
});

test('candidate actions validate IDs and require a reason for rejection', () => {
  assert.equal(directCandidateSchema.safeParse({ employeeUserId: 0 }).success, false);
  assert.equal(directCandidateSchema.safeParse({ employeeUserId: 7 }).success, true);
  assert.equal(reviewSchema.safeParse({ decision: 'REJECTED' }).success, false);
  assert.equal(reviewSchema.safeParse({ decision: 'REJECTED', reason: 'غير واضح' }).success, true);
  assert.equal(decideNominationsSchema.safeParse({ nominationIds: [1, 1], isConfirmed: true }).success, false);
  assert.equal(decideNominationsSchema.safeParse({ nominationIds: [1], isConfirmed: false }).success, false);
});

test('profile validation excludes protected name and employee number', () => {
  const result = updateProfileSchema.parse({
    email: 'user@example.com', phone: '123', jobTitle: 'مهندس',
    fullName: 'اسم غير مصرح', employeeNumber: '999',
  });
  assert.equal(result.fullName, undefined);
  assert.equal(result.employeeNumber, undefined);
  assert.equal(updateProfileSchema.safeParse({ email: 'not-an-email' }).success, false);
});
