const NEXT_STATUSES = {
  DRAFT: [['DRAFT', 'مسودة'], ['ACTIVE', 'نشطة']],
  ACTIVE: [['ACTIVE', 'نشطة'], ['COMPLETED', 'مكتملة'], ['CANCELLED', 'ملغاة']],
  COMPLETED: [['COMPLETED', 'مكتملة'], ['ARCHIVED', 'مؤرشفة']],
  ARCHIVED: [['ARCHIVED', 'مؤرشفة']],
  CANCELLED: [['CANCELLED', 'ملغاة']],
};

/** يضبط الحالات الممكنة، ويجعل التقرير مطلوبًا فقط عند أرشفة دورة مكتملة. */
export function configureCourseLifecycle(course, form) {
  const statusInput = form.querySelector('#courseStatus');
  const reportSection = form.querySelector('#finalReportSection');
  const reportInput = form.querySelector('#finalReportFile');
  const reportLink = form.querySelector('#existingFinalReportLink');
  const current = NEXT_STATUSES[course.status] ? course.status : 'ACTIVE';

  statusInput.replaceChildren(...NEXT_STATUSES[current].map(([value, label]) => new Option(label, value)));
  statusInput.value = current;

  if (course.final_report?.file_url) {
    reportLink.href = course.final_report.file_url;
    reportLink.textContent = `عرض التقرير الحالي: ${course.final_report.original_name}`;
    reportLink.classList.remove('hidden');
  }

  function refreshReportField() {
    const archiving = current === 'COMPLETED' && statusInput.value === 'ARCHIVED';
    reportSection.classList.toggle('hidden', !archiving && !course.final_report);
    reportInput.classList.toggle('hidden', !archiving);
    reportInput.required = archiving;
    if (current === 'COMPLETED') form.querySelector('button[type="submit"]').disabled = !archiving;
  }

  statusInput.addEventListener('change', refreshReportField);
  refreshReportField();

  // المكتملة تقبل الأرشفة وحدها، والملغاة/المؤرشفة للعرض فقط.
  if (current === 'COMPLETED' || current === 'CANCELLED' || current === 'ARCHIVED') {
    for (const field of form.querySelectorAll('input, select, textarea, button')) {
      if (field === statusInput || field === reportInput || field.type === 'submit') continue;
      field.disabled = true;
    }
    if (current !== 'COMPLETED') {
      statusInput.disabled = true;
      form.querySelector('button[type="submit"]').disabled = true;
    }
  }
}
