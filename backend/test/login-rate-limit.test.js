const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

/** يتحقق أن الدخول الناجح لا يستهلك حد المحاولات، بينما الفشل المتكرر يُحظر. */
test('login rate limit counts failed requests only', async () => {
  const controllerPath = require.resolve('../src/controllers/auth.controller');
  const routesPath = require.resolve('../src/routes/auth.routes');
  const originalController = require.cache[controllerPath];
  const originalRoutes = require.cache[routesPath];

  require.cache[controllerPath] = {
    id: controllerPath,
    filename: controllerPath,
    loaded: true,
    exports: {
      login(req, res) {
        return res.status(req.body.password === 'correct-password' ? 200 : 401)
          .json({ message: 'نتيجة الاختبار' });
      },
      me() {},
      logout() {},
    },
  };
  delete require.cache[routesPath];

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require(routesPath));
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const request = (password) => fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rate-limit-user', password }),
    });

    for (let index = 0; index < 12; index += 1) {
      const response = await request('correct-password');
      assert.equal(response.status, 200);
    }

    for (let index = 0; index < 10; index += 1) {
      const response = await request('wrong-password');
      assert.equal(response.status, 401);
    }

    const blockedResponse = await request('wrong-password');
    assert.equal(blockedResponse.status, 429);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));

    if (originalController) require.cache[controllerPath] = originalController;
    else delete require.cache[controllerPath];
    if (originalRoutes) require.cache[routesPath] = originalRoutes;
    else delete require.cache[routesPath];
  }
});
