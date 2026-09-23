import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const processes = [
  { name: 'Backend', entry: 'backend/node_modules/nodemon/bin/nodemon.js', args: ['src/server.js'], cwd: resolve(root, 'backend') },
  { name: 'Frontend', entry: 'node_modules/vite/bin/vite.js', args: [], cwd: root },
];

for (const item of processes) {
  item.entry = resolve(root, item.entry);
  if (!existsSync(item.entry)) {
    console.error(`تعذر تشغيل ${item.name}: ثبّت الحزم أولًا في جذر المشروع ومجلد backend.`);
    process.exit(1);
  }
}

let stopping = false;

/** ينهي الخادمين معًا عند Ctrl+C أو توقف أحدهما. */
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);

  for (const item of processes) {
    if (!item.child || item.child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(item.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(-item.child.pid, 'SIGTERM'); } catch { /* توقفت العملية بالفعل */ }
    }
  }
  process.exit(exitCode);
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

// بعض الطرفيات تمرّر Ctrl+C كحرف لا كإشارة؛ نتعامل مع الحالتين.
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (bytes) => {
    if (bytes.includes(3)) stop(0);
  });
}

for (const item of processes) {
  console.log(`تشغيل ${item.name}...`);
  item.child = spawn(process.execPath, [item.entry, ...item.args], {
    cwd: item.cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  item.child.once('error', (error) => {
    console.error(`تعذر تشغيل ${item.name}: ${error.message}`);
    stop(1);
  });
  item.child.once('exit', (code) => {
    if (!stopping) {
      console.error(`توقف ${item.name} (رمز الخروج: ${code ?? 'غير معروف'}).`);
      stop(code || 1);
    }
  });
}
