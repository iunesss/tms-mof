import { protectPage } from '../shared/auth-guard.js';
import { bindLiveFilters } from '../shared/live-filters.js';
import { courseStatusText } from '../shared/status-labels.js';

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ar-YE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

async function api(url) {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'تعذر تحميل السجل.');
  }

  return data;
}

function renderArchive(courses) {
  const body = document.querySelector('#archiveTableBody');

  document.querySelector('#archiveCountText').textContent =
    `إجمالي الدورات السابقة: ${courses.length}`;

  if (!courses.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="px-5 py-10 text-center text-xs text-slate-400">
          لا توجد دورات أو مهام سابقة في سجلك.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = courses.map((course) => `
    <tr class="transition hover:bg-slate-50">
      <td class="px-5 py-3 font-semibold text-slate-700">
        ${escapeHtml(course.course_no || '—')}
      </td>

      <td class="px-5 py-3 font-bold text-slate-900">
        ${escapeHtml(course.title)}
      </td>

      <td class="px-5 py-3 text-slate-600">
        ${course.course_type === 'MISSION' ? 'مهمة / بعثة' : 'دورة تدريبية'}
      </td>

      <td class="px-5 py-3 text-slate-500">
        ${formatDate(course.start_date)} — ${formatDate(course.end_date)}
      </td>

      <td class="px-5 py-3">
        <span class="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
          ${courseStatusText(course.status)}
        </span>
      </td>

      <td class="px-5 py-3">
        <a href="./course-info.html?id=${encodeURIComponent(course.id)}&from=archive" class="inline-block rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold transition hover:bg-brand-lightGold">
          عرض التفاصيل
        </a>
        ${course.final_report?.file_url ? `<a href="${escapeHtml(course.final_report.file_url)}" target="_blank" rel="noopener" class="mr-2 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">عرض التقرير</a>` : '<span class="mr-2 inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-400">لا يوجد تقرير</span>'}
      </td>
    </tr>
  `).join('');
}

async function loadArchive() {
  try {
    const search = document.querySelector('#archiveSearch').value.trim();
    const data = await api(`/api/courses/archive?search=${encodeURIComponent(search)}`);
    renderArchive(data.courses || []);
  } catch (error) {
    document.querySelector('#archiveTableBody').innerHTML = `
      <tr>
        <td colspan="6" class="px-5 py-10 text-center text-xs text-rose-600">
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;
  }
}

async function initialize() {
  const user = await protectPage(['EMPLOYEE']);
  if (!user) return;
  bindLiveFilters('main', loadArchive);
  await loadArchive();
}

initialize();
