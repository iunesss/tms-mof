const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'authentication-test-secret';
let result = [];
let failure;
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
  execute: async () => { if (failure) throw failure; return [result]; },
} };
const { authenticate } = require('../src/middleware/authenticate');
const { authorize } = require('../src/middleware/authorize');
const { requireOwnProfile, requireCandidateAccess } = require('../src/middleware/scope');

/** استجابة وهمية لاختبار middleware مستقلة عن HTTP وقاعدة البيانات. */
function response() {
  return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
test('authentication rejects missing/invalid tokens and inactive accounts', async () => {
  for (const token of [undefined, 'invalid', jwt.sign({ userId: 1 }, process.env.JWT_SECRET)]) {
    const res = response();
    await authenticate({ cookies: { tms_token: token } }, res, () => assert.fail('must reject'));
    assert.equal(res.statusCode, 401);
  }
});
test('database roles replace stale JWT roles', async () => {
  result = [{ id: 1, username: 'employee', role_code: 'EMPLOYEE' }];
  const req = { cookies: { tms_token: jwt.sign({ userId: 1, roles: ['SUPER_ADMIN'] }, process.env.JWT_SECRET) } };
  let called = false;
  await authenticate(req, response(), () => { called = true; });
  assert.ok(called);
  assert.deepEqual(req.user.roles, ['EMPLOYEE']);
});
test('database failure is forwarded rather than reported as expired session', async () => {
  failure = new Error('database unavailable');
  const req = { cookies: { tms_token: jwt.sign({ userId: 1 }, process.env.JWT_SECRET) } };
  await authenticate(req, response(), (error) => assert.equal(error, failure));
  failure = undefined;
});
test('authorization requires login and keeps super-admin compatibility', () => {
  let res = response();
  authorize('AGENT')({}, res, () => assert.fail());
  assert.equal(res.statusCode, 401);
  res = response();
  authorize('AGENT')({ user: { roles: ['EMPLOYEE'] } }, res, () => assert.fail());
  assert.equal(res.statusCode, 403);
  let called = false;
  authorize('AGENT')({ user: { roles: ['SUPER_ADMIN'] } }, response(), () => { called = true; });
  assert.ok(called);
});

test('profile scope accepts its owner and rejects another employee', () => {
  let passed = false;
  requireOwnProfile({ params: { userId: '5' }, user: { id: '5', roles: ['EMPLOYEE'] } },
    response(), () => { passed = true; });
  assert.ok(passed);
  const res = response();
  requireOwnProfile({ params: { userId: '6' }, user: { id: 5, roles: ['EMPLOYEE'] } },
    res, () => assert.fail());
  assert.equal(res.statusCode, 403);
});

test('candidate owner includes a self-nominated manager; other employees are forbidden', async () => {
  result = [{ id: 10, employee_user_id: 5, department_id: null, agent_user_id: null }];
  let passed = false;
  await requireCandidateAccess({ params: { candidateId: '10' }, user: { id: 5, roles: ['DEPARTMENT_MANAGER'] } },
    response(), () => { passed = true; });
  assert.ok(passed);
  const res = response();
  await requireCandidateAccess({ params: { candidateId: '10' }, user: { id: 6, roles: ['EMPLOYEE'] } },
    res, () => assert.fail());
  assert.equal(res.statusCode, 403);
});
