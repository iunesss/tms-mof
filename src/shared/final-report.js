/** يعرض التقرير النهائي للدورة المنتهية لمن يملك صلاحية عرض تفاصيلها. */
export function renderFinalReport(report, courseStatus) {
  const oldSection = document.querySelector('#finalReportSection');
  oldSection?.remove();

  if (!['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(courseStatus)) return;

  const section = document.createElement('section');
  section.id = 'finalReportSection';
  section.className = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';

  const title = document.createElement('h3');
  title.className = 'text-sm font-bold text-slate-900';
  title.textContent = 'التقرير النهائي للدورة';
  section.append(title);

  const content = report?.file_url ? document.createElement('a') : document.createElement('p');
  content.className = 'mt-3 inline-block text-xs font-semibold text-brand-darkGold';
  if (report?.file_url) {
    content.href = report.file_url;
    content.target = '_blank';
    content.rel = 'noopener';
    content.textContent = `عرض التقرير: ${report.original_name || 'التقرير النهائي'}`;
  } else {
    content.textContent = 'لا يوجد تقرير نهائي لهذه الدورة.';
  }
  section.append(content);
  document.querySelector('main')?.append(section);
}
