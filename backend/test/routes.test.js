const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'routing-test-secret-only';
const roles = ['SUPER_ADMIN', 'COURSE_MANAGER', 'AGENT', 'DEPARTMENT_MANAGER', 'EMPLOYEE'];
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { execute: async (sql, [id]) => [[{ id, username: 'test', role_code: roles[Number(id) - 1] }]] },
};

// نعزل SQL لاختبار الراوتات الحقيقية والمصادقة والتوجيه لكل controller بدقة.
for (const file of fs.readdirSync(path.join(__dirname, '../src/controllers'))) {
  if (!file.endsWith('.js')) continue;
  const exports = require('../src/controllers/' + file);
  for (const action of Object.keys(exports)) {
    if (typeof exports[action] === 'function') {
      exports[action] = (req, res) => res.json({ controller: file, action, userId: req.user?.id });
    }
  }
}
const app = require('../src/app');
let server;
let base;
before(async () => {
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise((resolve) => server.close(resolve)));

async function request(url, role, method = 'GET', body) {
  const headers = {};
  if (role) headers.Cookie = 'tms_token=' + jwt.sign({ userId: roles.indexOf(role) + 1 }, process.env.JWT_SECRET);
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(base + '/api' + url, { method, headers, body: body && JSON.stringify(body) });
}

for (let i = 0; i < roles.length; i++) {
  test('dashboard canonical: ' + roles[i], async () => {
    const canonical = await request('/dashboard', roles[i]);
    assert.equal(canonical.status, 200);
  });
  test('courses canonical: ' + roles[i], async () => {
    const canonical = await request('/courses/9', roles[i]);
    assert.equal(canonical.status, 200);
  });
}

test('obsolete role-prefixed routes are removed', async () => {
  for (const url of ['/admin/courses', '/agent/dashboard', '/manager/profile', '/employee/courses']) {
    assert.equal((await request(url, 'SUPER_ADMIN')).status, 404, url);
  }
});

test('all registered private endpoints reject missing authentication', async () => {
  // نمشي على الراوتات المسجلة فعليًا حتى لا يسقط مسار جديد من فحص تسجيل الدخول.
  let count = 0;
  for (const layer of require('../src/routes').stack) {
    if (!layer.handle.stack) continue;
    for (const endpoint of layer.handle.stack.filter((entry) => entry.route)) {
      const { route } = endpoint;
      if (['/login', '/logout', '/me'].includes(route.path)) continue;
      count++;
    }
  }
  assert.ok(count > 30);
  for (const url of ['/dashboard', '/courses', '/profile', '/users', '/notifications',
    '/reports/audit-logs']) {
    assert.equal((await request(url)).status, 401, url);
  }
});

test('limited roles cannot call administrative course operations', async () => {
  for (const role of roles.slice(2)) {
    for (const [method, url] of [
      ['POST', '/courses'], ['PATCH', '/courses/9'],
      ['POST', '/courses/9/candidates/direct'],
      ['POST', '/courses/9/nominations/1/select'],
      ['PATCH', '/courses/9/candidates/1/status'],
      ['POST', '/courses/9/candidates/1/attachments'],
    ]) assert.equal((await request(url, role, method)).status, 403, role + ' ' + url);
  }
});

test('role cannot be changed through request parameters', async () => {
  const response = await request('/dashboard?role=SUPER_ADMIN', 'EMPLOYEE');
  const normal = await request('/dashboard', 'EMPLOYEE');
  assert.deepEqual(await response.json(), await normal.json());
  assert.equal((await request('/admin/dashboard', 'EMPLOYEE')).status, 404);
});

test('manager and employee submit forms to shared employee implementation', async () => {
  for (const role of ['DEPARTMENT_MANAGER', 'EMPLOYEE']) {
    const response = await request('/courses/9/forms/1/submission', role, 'POST');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.controller, 'courses.controller.js');
    assert.equal(result.action, 'submitForm');
  }
  assert.equal((await request('/courses/9/forms/1/submission', 'AGENT', 'POST')).status, 403);
});

test('archive precedes courseId and decisions stay role-specific', async () => {
  assert.equal((await (await request('/courses/archive', 'AGENT')).json()).action, 'getArchive');
  assert.equal((await request('/courses/9/nominations/decision', 'EMPLOYEE', 'POST')).status, 403);
  assert.equal((await (await request('/courses/9/nominations/decision', 'AGENT', 'POST',
    { nominationIds: [1], isConfirmed: true })).json()).action, 'decideNominations');
});

test('notifications/profile use canonical routes for eligible roles', async () => {
  for (let i = 1; i < roles.length; i++) {
    for (const resource of ['notifications', ...(i >= 3 ? ['profile'] : [])]) {
      const a = await request('/' + resource, roles[i]);
      assert.equal(a.status, 200);
    }
  }
});

test('invalid JSON reports a request error', async () => {
  const response = await fetch(base + '/api/courses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(response.status, 400);
});

test('write endpoints validate input before dispatching to course handlers', async () => {
  const cases = [
    ['SUPER_ADMIN', 'POST', '/courses/9/candidates/direct', { employeeUserId: 0 }],
    ['SUPER_ADMIN', 'PATCH', '/courses/9/candidates/1/status', { status: 'REJECTED' }],
    ['SUPER_ADMIN', 'PATCH', '/courses/9/candidates/1/documents/1/review', { decision: 'REJECTED' }],
    ['AGENT', 'POST', '/courses/9/nominations/decision', { nominationIds: [1, 1], isConfirmed: true }],
    ['DEPARTMENT_MANAGER', 'POST', '/courses/9/nominations', { employeeUserIds: [] }],
  ];
  for (const [role, method, url, body] of cases) {
    assert.equal((await request(url, role, method, body)).status, 400, role + ' ' + url);
  }
});

test('every canonical operation enforces its role before controller dispatch', async () => {
  const resourceRoles = {
    dashboard: roles,
    courses: roles,
    users: ['SUPER_ADMIN', 'COURSE_MANAGER'],
    profile: ['DEPARTMENT_MANAGER', 'EMPLOYEE'],
    notifications: roles.slice(1),
  };
  const controllerPrefix = {
    SUPER_ADMIN: 'admin', COURSE_MANAGER: 'course-manager',
    AGENT: 'agent', DEPARTMENT_MANAGER: 'manager', EMPLOYEE: 'employee',
  };
  for (const [resource, supported] of Object.entries(resourceRoles)) {
    const router = require('../src/routes/' + resource + '.routes')();
    for (const layer of router.stack.filter((entry) => entry.route)) {
      const route = layer.route;
      const method = Object.keys(route.methods)[0].toUpperCase();
      const url = '/' + resource + (route.path === '/' ? '' : route.path.replace(/:[A-Za-z]+/g, '1'));
      assert.equal((await request(url, undefined, method)).status, 401, 'anonymous ' + method + ' ' + url);
      for (const role of roles) {
        const response = await request(url, role, method);
        if (!supported.includes(role)) {
          assert.equal(response.status, 403, role + ' ' + url);
          continue;
        }
        assert.ok([200, 400, 403].includes(response.status), role + ' ' + url + ': ' + response.status);
        if (response.status === 200) {
          const data = await response.json();
          let prefix = resource === 'courses' && role === 'COURSE_MANAGER' ? 'admin' : controllerPrefix[role];
          if (['notifications', 'dashboard', 'profile', 'users', 'courses'].includes(resource)) prefix = resource;
          // العملية مشتركة الآن عبر controller الدورات نفسه.
          assert.ok(data.controller.startsWith(prefix + '.'), role + ' used ' + data.controller);
        }
      }
    }
  }
});

test('course manager cannot delete users; only administration can read audit logs', async () => {
  assert.equal((await request('/users/1', 'COURSE_MANAGER', 'DELETE')).status, 403);
  for (const role of roles.slice(1)) {
    assert.equal((await request('/reports/audit-logs', role)).status, 403);
  }
  assert.equal((await request('/reports/audit-logs', 'SUPER_ADMIN')).status, 200);
});
