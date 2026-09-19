import { protectPage } from '../../shared/auth-guard.js';
import {
  api, getQuery, escapeHtml, formatDate, candidateStatusText,
} from '../manage-courses/course-api.js';

const courseId = getQuery('id');

function setText(selector, value) {
  document.querySelector(selector).textContent = value || '—';
}

function renderFiles(selector, files, emptyText) {
  const element = document.querySelector(selector);

  if (!files?.length) {
    element.textContent = emptyText;
    return;
  }

  element.innerHTML = files.map((file) => `
    <a href="${escapeHtml(file.file_url)}" target="_blank"
      class="ml-2 mb-2 inline-block rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-brand-darkGold">
      ${escapeHtml(file.title || file.original_name || file.attachment_type)}
    </a>
  `).join('');
}

function renderCandidates(candidates) {
  const grid = document.querySelector('#courseCandidatesGrid');

  if (!candidates.length) {
    grid.innerHTML = '<p class="text-xs text-slate-400">لا يوجد مشاركون أو مرشحون.</p>';
    return;
  }

  grid.innerHTML = candidates.map((candidate) => `
    <a href="./employee-info.html?courseId=${courseId}&candidateId=${candidate.id}"
      class="rounded-xl border border-slate-200 p-4 hover:border-brand-gold">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-bold">${escapeHtml(candidate.full_name)}</h3>
        <span class="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold">
          ${escapeHtml(candidateStatusText(candidate.status))}
        </span>
      </div>
      <p class="mt-2 text-xs text-slate-500">
        ${escapeHtml(candidate.department_name || '—')} — ${escapeHtml(candidate.sector_name || '—')}
      </p>
      <p class="mt-4 border-t pt-3 text-xs font-bold text-brand-darkGold">عرض بيانات الموظف ←</p>
    </a>
  `).join('');
}

async function initialize() {
  const session = await protectPage(['SUPER_ADMIN']);
  if (!session || !courseId) {
    if (!courseId) window.location.replace('./archive.html');
    return;
  }

  try {
    const [courseData, candidatesData] = await Promise.all([
      api(`/api/courses/${courseId}`),
      api(`/api/courses/${courseId}/candidates`),
    ]);

    const course = courseData.course || courseData;
    const candidates = candidatesData.candidates || [];

    setText('#courseTitle', course.title);
    setText('#courseNumber', course.course_no);
    setText('#providerName', course.provider);
    setText('#courseLocation', course.location);
    setText('#courseDates', `${formatDate(course.start_date)} إلى ${formatDate(course.end_date)}`);
    setText('#totalSeats', course.total_seats);
    setText('#candidatesCount', candidates.length);
    setText('#courseDescription', course.description || 'لا يوجد وصف.');

    document.querySelector('#courseTypeBadge').textContent =
      course.course_type === 'MISSION' ? 'مهمة / بعثة' : 'دورة تدريبية';

    document.querySelector('#courseStatusBadge').textContent =
      course.status === 'ARCHIVED' ? 'مؤرشفة'
        : course.status === 'COMPLETED' ? 'مكتملة'
          : course.status === 'CANCELLED' ? 'ملغاة'
            : course.status;

    if (course.status === 'COMPLETED') {
      const link = document.querySelector('#archiveCompletedCourseLink');
      link.href = `../manage-courses/alter-course.html?id=${encodeURIComponent(courseId)}`;
      link.classList.remove('hidden');
    }
    if (course.final_report?.file_url) {
      const link = document.querySelector('#finalReportDownload');
      link.href = course.final_report.file_url;
      link.textContent = `عرض التقرير: ${course.final_report.original_name}`;
      document.querySelector('#finalReportDisplay').classList.remove('hidden');
    }

    renderCandidates(candidates);
    renderFiles('#courseAttachmentsList', course.attachments, 'لا توجد مرفقات.');
    renderFiles('#courseFormsList', course.forms, 'لا توجد استمارات مطلوبة.');
  } catch (error) {
    setText('#courseTitle', error.message);
  }
}

initialize();
