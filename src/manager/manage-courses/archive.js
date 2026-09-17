import { protectPage } from '../../shared/auth-guard.js';

const state = { page: 1, totalPages: 1 };

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

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'تعذر تنفيذ الطلب.');
  }

  return data;
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('/src/login/index.html');
  }
}

function buildQuery() {
  const params = new URLSearchParams({
    page: String(state.page),
    limit: '12',
  });

  const search = document.querySelector('#archiveSearch').value.trim();
  const courseType = document.querySelector('#archiveCourseType').value;
  const year = document.querySelector('#archiveYear').value;

  if (search) params.set('search', search);
  if (courseType) params.set('courseType', courseType);
  if (year) params.set('year', year);

  return params.toString();
}

function renderYears(years) {
  const select = document.querySelector('#archiveYear');
  const selected = select.value;

  select.innerHTML = `
    <option value="">كل السنوات</option>
    ${years.map((year) => `<option value="${year}">${year}</option>`).join('')}
  `;

  select.value = selected;
}

function renderCourses(courses) {
  const body = document.querySelector('#archiveCoursesTableBody');

  if (!courses.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-10 text-center text-xs text-slate-400">
          لا توجد دورات سابقة للقسم.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = courses.map((course) => `
    <tr class="hover:bg-slate-50">
      <td class="px-5 py-3 font-semibold text-slate-700">${escapeHtml(course.course_no || '—')}</td>
      <td class="px-5 py-3 font-bold text-slate-900">${escapeHtml(course.title)}</td>
      <td class="px-5 py-3">${course.course_type === 'MISSION' ? 'مهمة / بعثة' : 'دورة تدريبية'}</td>
      <td class="px-5 py-3 text-slate-500">${formatDate(course.start_date)} — ${formatDate(course.end_date)}</td>
      <td class="px-5 py-3 font-bold text-slate-700">${Number(course.department_candidates_count || 0)}</td>
      <td class="px-5 py-3"><span class="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">${escapeHtml(course.status)}</span></td>
      <td class="px-5 py-3">
        <a href="./course-info.html?id=${encodeURIComponent(course.id)}" class="rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold">
          عرض التفاصيل
        </a>
      </td>
    </tr>
  `).join('');
}

function renderPagination(pagination) {
  state.totalPages = pagination.totalPages || 1;

  document.querySelector('#archivedCoursesTotal').textContent =
    `إجمالي النتائج: ${pagination.total || 0}`;

  document.querySelector('#archivePageInfo').textContent =
    `صفحة ${pagination.page} من ${state.totalPages}`;

  document.querySelector('#archivePaginationText').textContent =
    `صفحة ${pagination.page} من ${state.totalPages}`;

  document.querySelector('#previousArchivePageButton').disabled =
    pagination.page <= 1;

  document.querySelector('#nextArchivePageButton').disabled =
    pagination.page >= state.totalPages;
}

async function loadArchive() {
  try {
    const data = await api(`/api/manager/courses/archive?${buildQuery()}`);

    renderYears(data.years || []);
    renderCourses(data.courses || []);
    renderPagination(data.pagination || {
      page: 1,
      totalPages: 1,
      total: 0,
    });
  } catch (error) {
    document.querySelector('#archiveCoursesTableBody').innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-10 text-center text-xs text-rose-600">
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;
  }
}

async function initialize() {
  const user = await protectPage(['DEPARTMENT_MANAGER']);
  if (!user) return;

  document.querySelector('#currentUserName').textContent =
    user.fullName || user.full_name || user.username || 'مدير القسم';

  document.querySelector('#logoutButton').onclick = logout;

  document.querySelector('#searchArchiveButton').onclick = () => {
    state.page = 1;
    loadArchive();
  };

  document.querySelector('#clearArchiveFiltersButton').onclick = () => {
    document.querySelector('#archiveSearch').value = '';
    document.querySelector('#archiveCourseType').value = '';
    document.querySelector('#archiveYear').value = '';
    state.page = 1;
    loadArchive();
  };

  document.querySelector('#previousArchivePageButton').onclick = () => {
    if (state.page > 1) {
      state.page -= 1;
      loadArchive();
    }
  };

  document.querySelector('#nextArchivePageButton').onclick = () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      loadArchive();
    }
  };

  await loadArchive();
}

initialize();