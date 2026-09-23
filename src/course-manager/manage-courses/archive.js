import { protectPage } from '../../shared/auth-guard.js';
import { bindLiveFilters } from '../../shared/live-filters.js';

import {
  api,
  escapeHtml,
  formatDate,
  courseStatusText,
} from '../manage-courses/course-api.js';

const state = {
  page: 1,
  totalPages: 1,
};

function courseTypeText(type) {
  return type === 'MISSION' ? 'مهمة / بعثة' : 'دورة تدريبية';
}

function showMessage(message) {
  const body = document.querySelector('#archiveCoursesTableBody');

  body.innerHTML = `
    <tr>
      <td colspan="6" class="px-5 py-10 text-center text-xs text-rose-600">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

function buildQuery() {
  const params = new URLSearchParams({
    page: String(state.page),
    limit: '12',
  });

  const search = document.querySelector('#archiveSearch').value.trim();
  const courseType = document.querySelector('#archiveCourseType').value;
  const status = document.querySelector('#archiveStatus').value;
  const year = document.querySelector('#archiveYear').value;

  if (search) params.set('search', search);
  if (courseType) params.set('courseType', courseType);
  if (status) params.set('status', status);
  if (year) params.set('year', year);

  return params.toString();
}

function renderYears(years) {
  const select = document.querySelector('#archiveYear');
  const selectedValue = select.value;

  select.innerHTML = `
    <option value="">كل السنوات</option>
    ${years
      .map(
        (year) => `
          <option value="${year}">
            ${year}
          </option>
        `
      )
      .join('')}
  `;

  select.value = selectedValue;
}

function renderCourses(courses) {
  const body = document.querySelector('#archiveCoursesTableBody');

  if (!courses.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="px-5 py-10 text-center text-xs text-slate-400">
          لا توجد دورات أو مهام مطابقة للبحث.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = courses
    .map(
      (course) => `
        <tr class="transition hover:bg-slate-50">
          <td class="px-5 py-3 font-semibold text-slate-700">
            ${escapeHtml(course.course_no)}
          </td>

          <td class="px-5 py-3 font-bold text-slate-900">
            ${escapeHtml(course.title)}
          </td>

          <td class="px-5 py-3">
            ${escapeHtml(courseTypeText(course.course_type))}
          </td>

          <td class="px-5 py-3 text-slate-500">
            ${formatDate(course.start_date)}
            <span class="mx-1">—</span>
            ${formatDate(course.end_date)}
          </td>

          <td class="px-5 py-3">
            <span class="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
              ${escapeHtml(courseStatusText(course.status))}
            </span>
          </td>

          <td class="px-5 py-3">
            <a
href="./manage-course.html?id=${encodeURIComponent(course.id)}"
              class="inline-block rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold transition hover:bg-brand-lightGold"
            >
              عرض التفاصيل
            </a>
            ${course.final_report?.file_url ? `<a href="${escapeHtml(course.final_report.file_url)}" target="_blank" rel="noopener" class="mr-2 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">عرض التقرير</a>` : '<span class="mr-2 inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-400">لا يوجد تقرير</span>'}
          </td>
        </tr>
      `
    )
    .join('');
}

function renderPagination(pagination) {
  const safePagination = pagination || {
    page: 1,
    totalPages: 1,
    total: 0,
  };

  state.totalPages = safePagination.totalPages || 1;

  document.querySelector('#archivedCoursesTotal').textContent =
    `إجمالي النتائج: ${safePagination.total || 0}`;

  document.querySelector('#archivePageInfo').textContent =
    `صفحة ${safePagination.page} من ${state.totalPages}`;

  document.querySelector('#archivePaginationText').textContent =
    `صفحة ${safePagination.page} من ${state.totalPages}`;

  document.querySelector('#previousArchivePageButton').disabled =
    safePagination.page <= 1;

  document.querySelector('#nextArchivePageButton').disabled =
    safePagination.page >= state.totalPages;
}

async function loadArchive() {
  try {
    const data = await api(
      `/api/reports/archive?${buildQuery()}`
    );

    renderYears(data.years || []);
    renderCourses(data.courses || []);
    renderPagination(data.pagination);
  } catch (error) {
    showMessage(error.message || 'تعذر تحميل أرشيف الدورات.');
  }
}

function clearFilters() {
  document.querySelector('#archiveSearch').value = '';
  document.querySelector('#archiveCourseType').value = '';
  document.querySelector('#archiveStatus').value = '';
  document.querySelector('#archiveYear').value = '';

  state.page = 1;
  loadArchive();
}

bindLiveFilters('main', () => {
  state.page = 1;
  loadArchive();
});

document.querySelector('#clearArchiveFiltersButton').addEventListener(
  'click',
  clearFilters
);

document.querySelector('#previousArchivePageButton').addEventListener(
  'click',
  () => {
    if (state.page > 1) {
      state.page -= 1;
      loadArchive();
    }
  }
);

document.querySelector('#nextArchivePageButton').addEventListener(
  'click',
  () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      loadArchive();
    }
  }
);

document.querySelector('#archiveSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    state.page = 1;
    loadArchive();
  }
});

async function initialize() {
  const session = await protectPage(['COURSE_MANAGER']);

  if (!session) return;

  await loadArchive();
}

initialize();
