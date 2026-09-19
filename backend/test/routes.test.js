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

const prefixes = ['admin', 'course-manager', 'agent', 'manager', 'employee'];
for (let i = 0; i < roles.length; i++) {
  test('dashboard canonical and legacy: ' + roles[i], async () => {
    const canonical = await request('/dashboard', roles[i]);
    const legacy = await request('/' + prefixes[i] + '/dashboard', roles[i]);
    assert.equal(canonical.status, 200);
    assert.equal(legacy.status, 200);
    assert.deepEqual(await canonical.json(), await legacy.json());
  });
  test('courses canonical and legacy: ' + roles[i], async () => {
    const oldPrefix = i === 1 ? 'admin' : prefixes[i];
    const canonical = await request('/courses/9', roles[i]);
    const legacy = await request('/' + oldPrefix + '/courses/9', roles[i]);
    assert.equal(canonical.status, 200);
    assert.equal(legacy.status, 200);
    assert.deepEqual(await canonical.json(), await legacy.json());
  });
}

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
  assert.ok(count > 80);
  for (const url of ['/dashboard', '/courses', '/profile', '/users', '/notifications',
    '/admin/courses', '/manager/profile', '/employee/courses', '/reports/audit-logs']) {
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
      ['GET', '/admin/courses/9'],
    ]) assert.equal((await request(url, role, method)).status, 403, role + ' ' + url);
  }
});

test('role cannot be changed through request parameters', async () => {
  const response = await request('/dashboard?role=SUPER_ADMIN', 'EMPLOYEE');
  assert.equal((await response.json()).controller, 'employee.dashboard.controller.js');
  assert.equal((await request('/admin/dashboard', 'EMPLOYEE')).status, 403);
});

test('manager and employee submit forms to shared employee implementation', async () => {
  for (const role of ['DEPARTMENT_MANAGER', 'EMPLOYEE']) {
    const response = await request('/courses/9/forms/1/submission', role, 'POST');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.controller, 'employee.courses.controller.js');
    assert.equal(result.action, 'submitForm');
  }
  assert.equal((await request('/courses/9/forms/1/submission', 'AGENT', 'POST')).status, 403);
});

test('archive precedes courseId and decisions stay role-specific', async () => {
  assert.equal((await (await request('/courses/archive', 'AGENT')).json()).action, 'getArchive');
  assert.equal((await request('/courses/9/nominations/decision', 'EMPLOYEE', 'POST')).status, 403);
  assert.equal((await (await request('/courses/9/nominations/decision', 'AGENT', 'POST')).json()).action, 'decideNominations');
});

test('notifications/profile legacy payloads keep the same handlers', async () => {
  for (let i = 1; i < roles.length; i++) {
    for (const resource of ['notifications', ...(i >= 3 ? ['profile'] : [])]) {
      const a = await request('/' + resource, roles[i]);
      const b = await request('/' + prefixes[i] + '/' + resource, roles[i]);
      assert.equal(a.status, 200);
      assert.deepEqual(await a.json(), await b.json());
    }
  }
});

test('invalid JSON reports a request error', async () => {
  const response = await fetch(base + '/api/courses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(response.status, 400);
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
          if (resource === 'courses' && route.path.includes('/forms/') && method === 'POST') prefix = 'employee';
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
