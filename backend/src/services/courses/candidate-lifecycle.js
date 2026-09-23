const PRELIMINARY_SOURCES = new Set([
  'SELECTED',
  'DOCUMENTS_PENDING',
  'DOCUMENTS_UNDER_REVIEW',
]);

/** يمنع القفز مباشرة إلى التأكيد أو تكرار قرار سبق اتخاذه. */
function assertCandidateDecision(currentStatus, nextStatus) {
  if (nextStatus === 'PRELIMINARILY_ACCEPTED' && !PRELIMINARY_SOURCES.has(currentStatus)) {
    throw new Error('القبول المبدئي غير متاح في حالة المرشح الحالية.');
  }
  if (nextStatus === 'CONFIRMED' && currentStatus !== 'PRELIMINARILY_ACCEPTED') {
    throw new Error('لا يمكن تأكيد المرشح قبل قبوله مبدئيًا واعتماد مستنداته.');
  }
}

module.exports = { assertCandidateDecision };
