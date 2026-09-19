const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const uploads = require('../src/middleware/upload.middleware');
const { errorHandler } = require('../src/middleware/error-handler');
const app = express();
const createdFiles = new Set();

/** يسجل ملفات الاختبار فقط لإزالتها لاحقًا دون لمس الملفات المرفوعة من المستخدمين. */
function received(req, res) {
  const files = req.file ? [req.file] : Object.values(req.files || {}).flat();
  for (const file of files) createdFiles.add(file.path);
  res.json(files.map((file) => ({ path: file.path, size: file.size })));
}
app.post('/profile', uploads.profileUpload.single('passportFile'), received);
app.post('/form', uploads.employeeFormUpload.single('formFile'), received);
app.post('/attachment', uploads.candidateAttachmentUpload.single('attachmentFile'), received);
app.post('/course', uploads.courseUpload, received);
app.use(errorHandler);
let server;
let base;
before(async () => {
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const file of createdFiles) await fs.unlink(file);
});
async function send(url, field, name, type, size = 16) {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(size)], { type }), name);
  return fetch(base + url, { method: 'POST', body: form });
}
test('all upload purposes preserve public directories and multipart field names', async () => {
  for (const [url, field, directory] of [
    ['/profile', 'passportFile', 'profiles'],
    ['/form', 'formFile', 'forms'],
    ['/attachment', 'attachmentFile', 'candidate-attachments'],
    ['/course', 'courseFormTemplates', 'courses'],
  ]) {
    const res = await send(url, field, 'test.pdf', 'application/pdf');
    assert.equal(res.status, 200);
    const [file] = await res.json();
    assert.equal(path.dirname(file.path), path.join(uploads.UPLOAD_ROOT, directory));
    assert.equal((await fs.stat(file.path)).size, 16);
  }
});
test('profile rejects Word while forms accept it', async () => {
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.equal((await send('/profile', 'passportFile', 'test.docx', mime)).status, 400);
  assert.equal((await send('/form', 'formFile', 'test.docx', mime)).status, 200);
});
test('mismatched extension and unknown multipart fields are rejected', async () => {
  assert.equal((await send('/profile', 'passportFile', 'test.html', 'application/pdf')).status, 400);
  assert.equal((await send('/profile', 'wrongField', 'test.pdf', 'application/pdf')).status, 400);
});
test('10 MB limit is enforced', async () => {
  assert.equal((await send('/attachment', 'attachmentFile', 'test.pdf', 'application/pdf',
    uploads.MAX_FILE_SIZE + 1)).status, 400);
});
