import { globSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// فحص ساكن لروابط الصفحات وعناصر DOM الثابتة التي تعتمد عليها ملفات JavaScript.
const problems = [];
let pages = 0;
for (const htmlPath of globSync('src/**/*.html')) {
  pages += 1;
  const html = readFileSync(htmlPath, 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  for (const match of html.matchAll(/\b(?:href|src)="(\.{1,2}\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    const target = resolve(dirname(htmlPath), match[1]);
    if (!existsSync(target)) problems.push(`${htmlPath}: رابط مفقود ${match[1]}`);
  }

  for (const match of html.matchAll(/<script\b[^>]*\bsrc="(\.{1,2}\/[^"?#]+)"[^>]*>/g)) {
    const scriptPath = resolve(dirname(htmlPath), match[1]);
    if (!existsSync(scriptPath)) continue;
    const script = readFileSync(scriptPath, 'utf8');
    const dynamicIds = new Set([
      ...[...script.matchAll(/\bid="([\w-]+)"/g)].map((match) => match[1]),
      ...[...script.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)].map((match) => match[1]),
    ]);
    for (const selector of script.matchAll(/\b(?:document\.)?querySelector\(['"]#([\w-]+)['"]\)/g)) {
      if (!ids.has(selector[1]) && !dynamicIds.has(selector[1])) {
        problems.push(`${scriptPath}: #${selector[1]} غير موجود في ${htmlPath}`);
      }
    }
  }
}

console.log(`فُحصت ${pages} صفحة؛ المشاكل: ${problems.length}`);
for (const problem of problems) console.error(problem);
if (problems.length) process.exitCode = 1;
