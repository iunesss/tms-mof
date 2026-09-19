import { protectPage } from '../../shared/auth-guard.js';
import {
  api, getQuery, escapeHtml, formatDate, candidateStatusText,
} from '../manage-courses/course-api.js';

const courseId = getQuery('courseId');
const candidateId = getQuery('candidateId');

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
      ${escapeHtml(file.name || file.original_name || 'فتح الملف')}
    </a>
  `).join('');
}

async function initialize() {
  const session = await protectPage(['SUPER_ADMIN']);
  if (!session) return;

  if (!courseId || !candidateId) {
    window.location.replace('./archive.html');
    return;
  }

  const backUrl = `./course-info.html?id=${courseId}`;
  document.querySelector('#backLink').href = backUrl;
  document.querySelector('#backButton').href = backUrl;

  try {
    const data = await api(
      `/api/courses/${courseId}/candidates/${candidateId}`
    );

    const candidate = data.candidate || data;
    const snapshot = candidate.snapshot || {};

    setText('#courseName', candidate.course_title);
    setText('#employeeName', candidate.full_name);
    setText('#employeeNumber', candidate.employee_number);
    setText('#candidateStatus', candidateStatusText(candidate.status));
    setText('#department', snapshot.department_name);
    setText('#sector', snapshot.sector_name);
    setText('#jobTitle', snapshot.job_title);
    setText('#email', snapshot.email);
    setText('#phone', snapshot.phone);
    setText('#selectedAt', formatDate(candidate.selected_at));

    renderFiles(
      '#formsList',
      candidate.forms,
      'لم يرفع الموظف أي استمارة حتى الآن.'
    );

    renderFiles(
      '#profileDocumentsList',
      candidate.profile_documents,
      'لا توجد مستندات ملف شخصي متاحة.'
    );
  } catch (error) {
    setText('#employeeName', error.message);
  }
}

initialize();
