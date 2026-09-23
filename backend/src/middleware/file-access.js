// express.static يعطي وصولاً عاماً وبدون صلاحيات (Public Access)؛ أي شخص يتوقع اسم الصورة أو الملف يقدر يحمله مباشرة عبر الرابط!
// بينما في مشروعنا، الملفات قد تكون مستندات حساسة أو استمارات دورات خاصة بموظفين محددين. لذا كتبنا هذا الـ Middleware ليفحص صلاحية المستخدم والمالك والدورة في قاعدة البيانات قبل أن يرسل الملف للعميل
const path = require('node:path');
const fs = require('node:fs/promises');
// مستودع الاستعلامات
const repository = require('../repositories/files.repository');
const { UPLOAD_ROOT } = require('./upload.middleware');

// العرض المباشر محصور بالصور وPDF؛ بقية الأنواع تنزل كمرفق لمنع تشغيل HTML/SVG.
const inlineTypes = new Map([
  ['.pdf', 'application/pdf'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
]);

/** يمنع اجتياز المجلدات والروابط الرمزية التي تخرج من جذر التخزين. */
async function resolveStoredPath(storageKey) {
  const parts = storageKey.split('/');
  // يرفض روابط الي تحتوي على .. للرجوع للخلف وقراءه ملفات الباك اند
  if (parts.some((part) => !part || part === '.' || part === '..') ||
      /[\\\\:\x00-\x1f]/.test(storageKey)) return null;
  const root = await fs.realpath(UPLOAD_ROOT);
  const resolved = await fs.realpath(path.join(root, ...parts));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

/**
 * بديل express.static تحت /uploads. يستدعى بعد authenticate لكل GET وHEAD.
 * الاسم العشوائي أو معرفة الرابط لا يمنحان الصلاحية؛ نفحص المالك/الدورة في قاعدة البيانات.
 */
async function serveAuthorizedFile(req, res, next) {

  res.set('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.set('Allow', 'GET, HEAD');
    return res.status(405).json({ message: 'طريقة الطلب غير مسموحة.' });
  }
  let storageKey;
  try {
    // تنظيف اسم الملف من ترميزات الروابط مثل %
    storageKey = decodeURIComponent(req.path.slice(1));
  } catch {
    return res.status(400).json({ message: 'رابط الملف غير صالح.' });
  }
  // التحقق من أن الرابط لا يحتوي على مسارات غير صالحة أو محاولات اجتياز المجلدات
  if (!storageKey || storageKey.split('/').some((p) => !p || p === '.' || p === '..') ||
      /[\\\\:\x00-\x1f]/.test(storageKey)) {
    return res.status(400).json({ message: 'رابط الملف غير صالح.' });
  }

  try {
    // نبحث عن الملف في قاعدة البيانات ونحصل على المراجع (References) التي تحدد من يمكنه الوصول إليه
    const file = await repository.findFile(storageKey);
    if (!file) return res.status(404).json({ message: 'الملف غير موجود.' });
    const references = await repository.getFileReferences(file.id);
  // منح الوصول للادمن او مدير الدورة
    const reviewer = req.user.roles.some((role) => ['SUPER_ADMIN', 'COURSE_MANAGER'].includes(role));
    let allowed = reviewer && references.length > 0;
// نتاكد هل الملف خاص بالمستخدك او هل الملف ببلك خاص بالدورة
    if (!allowed) {
      const privateReferences = references.filter((reference) => reference.kind === 'private');
      if (privateReferences.length) {
        allowed = privateReferences.every((reference) => String(reference.owner_user_id) === String(req.user.id));
      } else {
        for (const reference of references) {
          if (reference.kind === 'course' && await repository.canReadCourse(reference.course_id, req.user)) {
            allowed = true;
            break;
          }
        }
      }
    }
    // إذا لم يكن المستخدم مالكًا للملف أو مشرفًا على الدورة، لا يُسمح له بالوصول.
    if (!allowed) return res.status(403).json({ message: 'ليس لديك صلاحية لعرض هذا الملف.' });

    // تحقّق من وجود الملف داخل مساحة التخزين المسموحة.
    const diskPath = await resolveStoredPath(file.storage_key);
    if (!diskPath) return res.status(404).json({ message: 'الملف غير موجود.' });
    const extension = path.extname(diskPath).toLowerCase();
    const mimeType = inlineTypes.get(extension);
    res.set('X-Content-Type-Options', 'nosniff');
    // Chromium لا يعرض PDF إذا أُرسل مع CSP sandbox؛ الصور تبقى معزولة.
    if (mimeType === 'application/pdf') res.removeHeader('Content-Security-Policy');
    else res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    res.type(mimeType || 'application/octet-stream');
    res.set('Content-Disposition', mimeType ? 'inline' : 'attachment');
    return res.sendFile(diskPath, { cacheControl: false, lastModified: false, dotfiles: 'deny' }, (error) => {
      if (error) {
        if (error.code === 'ENOENT' || error.status === 404) {
          if (!res.headersSent) res.status(404).json({ message: 'الملف غير موجود.' });
        } else next(error);
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return res.status(404).json({ message: 'الملف غير موجود.' });
    }
    return next(error);
  }
}
module.exports = { serveAuthorizedFile, resolveStoredPath };
