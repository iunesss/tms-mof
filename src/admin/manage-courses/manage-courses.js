import { protectPage } from '../../shared/auth-guard.js';
import {
  api,
  getQuery,
  escapeHtml,
  formatDate,
  courseStatusText,
  candidateStatusText,
} from './course-api.js';

const courseId = getQuery('id');

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value || '—';
  }
}

function showPageError(message) {
  let messageBox = document.querySelector('#coursePageMessage');

  if (!messageBox) {
    messageBox = document.createElement('div');
    messageBox.id = 'coursePageMessage';
    messageBox.className =
      'rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-xs font-semibold text-rose-700';

    document.querySelector('main').prepend(messageBox);
  }

  messageBox.textContent = message;
}

function renderAllocations(allocations) {
  const body = document.querySelector('#courseAllocationsTableBody');

  if (!body) return;

  if (!allocations.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="px-5 py-8 text-center text-xs text-slate-400">
          لا يوجد توزيع مقاعد مسجل.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = allocations.map((allocation) => `
    <tr>
      <td class="px-5 py-3">${escapeHtml(allocation.sector_name)}</td>
      <td class="px-5 py-3">${escapeHtml(allocation.department_name)}</td>
      <td class="px-5 py-3">${allocation.nomination_limit || 0}</td>
      <td class="px-5 py-3">${allocation.nominations_count || 0}</td>
      <td class="px-5 py-3">${allocation.remaining_nominations || 0}</td>
    </tr>
  `).join('');
}

function renderCandidates(candidates) {
  const grid = document.querySelector('#courseCandidatesGrid');
  const countText = document.querySelector('#courseCandidatesCountText');

  if (countText) {
    countText.textContent = `إجمالي المرشحين: ${candidates.length}`;
  }

  if (!grid) return;

  if (!candidates.length) {
    grid.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
        لا يوجد مرشحون لهذه الدورة حتى الآن.
      </div>
    `;
    return;
  }

  grid.innerHTML = candidates.map((candidate) => `
    <a
href="../reports/employee-info.html?courseId=${courseId}&candidateId=${candidate.id}"
      class="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-gold hover:shadow-sm"
    >
      <div class="flex items-center justify-between gap-3">
        <h4 class="text-sm font-bold text-slate-900">
          ${escapeHtml(candidate.full_name)}
        </h4>

        <span class="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
          ${candidateStatusText(candidate.status)}
        </span>
      </div>

      <p class="mt-2 text-xs text-slate-500">
        ${escapeHtml(candidate.department_name || '—')}
        —
        ${escapeHtml(candidate.sector_name || '—')}
      </p>

      <p class="mt-4 border-t border-slate-100 pt-3 text-xs font-bold text-brand-darkGold">
        عرض بيانات الموظف ←      </p>
    </a>
  `).join('');
}

function renderAttachments(attachments) {
  const container = document.querySelector('#courseAttachmentsList');

  if (!container) return;

  if (!attachments.length) {
    container.textContent = 'لا توجد أجندة أو مرفقات مضافة حاليًا.';
    return;
  }

  container.innerHTML = attachments.map((attachment) => `
    <a
      href="${escapeHtml(attachment.file_url)}"
      target="_blank"
      class="ml-2 mb-2 inline-block rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-brand-darkGold transition hover:bg-brand-lightGold"
    >
      ${escapeHtml(attachment.attachment_type)}:
      ${escapeHtml(attachment.original_name)}
    </a>
  `).join('');
}

function configureMissionSection(course) {
  const section = document.querySelector('#directCandidatesSection');

  if (!section) return;

  if (course.course_type === 'MISSION') {
    section.classList.remove('hidden');
  } else {
    section.classList.add('hidden');
  }
}

async function initialize() {
  const session = await protectPage(['SUPER_ADMIN']);

  if (!session) {
    return;
  }

  if (!courseId) {
    window.location.replace('./main-courses.html');
    return;
  }

  try {
    const [courseData, candidatesData] = await Promise.all([
      api(`/api/admin/courses/${courseId}`),
      api(`/api/admin/courses/${courseId}/candidates`),
    ]);

    const course = courseData.course || courseData;
    const candidates = candidatesData.candidates || [];

    setText('#courseTitle', course.title);
    setText('#courseNumber', course.course_no || 'بدون رقم');
    setText('#providerName', course.provider || '—');
    setText('#courseLocation', course.location || '—');

    setText(
      '#courseDates',
      `${formatDate(course.start_date)} إلى ${formatDate(course.end_date)}`
    );

    setText(
      '#nominationDeadline',
      course.course_type === 'TRAINING'
        ? formatDate(course.nomination_deadline)
        : 'لا ينطبق على المهمة'
    );

    setText('#totalSeats', course.total_seats);
    setText('#candidatesCount', candidates.length);
    setText('#courseDescription', course.description || 'لا يوجد وصف.');

    const typeBadge = document.querySelector('#courseTypeBadge');
    const statusBadge = document.querySelector('#courseStatusBadge');
    const editLink = document.querySelector('#editCourseLink');

    if (typeBadge) {
      typeBadge.textContent = course.course_type === 'MISSION'
        ? 'مهمة / بعثة'
        : 'دورة تدريبية';
    }

    if (statusBadge) {
      statusBadge.textContent = courseStatusText(course.status);
    }

    if (editLink) {
      editLink.href = `./alter-course.html?id=${courseId}`;
    }
renderCourseForms(course.forms || []);
    renderAllocations(course.allocations || []);
    renderCandidates(candidates);
    renderAttachments(course.attachments || []);
    configureMissionSection(course);
  } catch (error) {
    console.error('Course details error:', error);

    showPageError(
      error.message || 'تعذر تحميل تفاصيل الدورة. حاول تحديث الصفحة.'
    );

    setText('#courseTitle', 'تعذر تحميل تفاصيل الدورة');
  }
}
function renderCourseForms(forms = []) {
  const element = document.querySelector('#courseFormsList');

  if (!forms.length) {
    element.innerHTML = `
      <p class="text-xs text-slate-500">
        لا توجد استمارات مطلوبة حاليًا.
      </p>
    `;
    return;
  }

  element.innerHTML = `
    <div class="space-y-2">
      ${forms
        .map(
          (form) => `
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p class="text-xs font-bold text-slate-800">
                  ${escapeHtml(form.title)}
                </p>

                <p class="mt-1 text-[11px] ${
                  Number(form.is_required)
                    ? 'text-rose-600'
                    : 'text-slate-500'
                }">
                  ${
                    Number(form.is_required)
                      ? 'استمارة إلزامية'
                      : 'استمارة اختيارية'
                  }
                </p>
              </div>

              <a
                href="${escapeHtml(form.file_url)}"
                target="_blank"
                rel="noopener"
                class="rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold hover:bg-brand-lightGold"
              >
                تحميل الاستمارة
              </a>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}
initialize();