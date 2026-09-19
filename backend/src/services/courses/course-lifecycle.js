const ACTIVE_STATUSES = new Set([
  'OPEN_FOR_NOMINATION',
  'NOMINATION_CLOSED',
  'CANDIDATE_PROCESSING',
  'ACTIVE',
]);

/** يتحقق من انتقال الحالة الحقيقي في قاعدة البيانات، لا من قائمة الواجهة فقط. */
function assertCourseTransition(current, requested) {
  if (current === requested && (current === 'DRAFT' || ACTIVE_STATUSES.has(current))) return;

  const allowed = current === 'DRAFT'
    ? ACTIVE_STATUSES.has(requested)
    : ACTIVE_STATUSES.has(current)
      ? requested === 'COMPLETED' || requested === 'CANCELLED'
      : current === 'COMPLETED' && requested === 'ARCHIVED';

  if (!allowed) {
    throw new Error('انتقال حالة الدورة غير مسموح. المسار: مسودة ← نشطة ← مكتملة ← مؤرشفة، أو نشطة ← ملغاة.');
  }
}

module.exports = { ACTIVE_STATUSES, assertCourseTransition };
