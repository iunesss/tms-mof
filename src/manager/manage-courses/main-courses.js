import { protectPage } from '../../shared/auth-guard.js';
import { bindLiveFilters } from '../../shared/live-filters.js';
import { courseStatusText } from '../../shared/status-labels.js';

const state = { limit: 3 };

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

function statusClass(status) {
  const classes = {
    ACTIVE: 'bg-brand-lightGold text-brand-darkGold',
    OPEN_FOR_NOMINATION: 'bg-brand-lightGold text-brand-darkGold',
    NOMINATION_CLOSED: 'bg-amber-50 text-amber-700',
    CANDIDATE_PROCESSING: 'bg-violet-50 text-violet-700',
  };
  return classes[status] || 'bg-slate-100 text-slate-600';
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

function setIdentity(user) {
  document.querySelector('#currentUserName').textContent =
    user.fullName || user.full_name || user.username || 'مدير القسم';
}

function renderCourses(courses) {
  const grid = document.querySelector('#coursesGrid');

  if (!courses.length) {
    grid.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
        لا توجد دورات مدعوة لها قسمك.
      </div>
    `;
    return;
  }

  grid.innerHTML = courses.slice(0, 3).map((course) => {
    const detailsUrl = `./course-info.html?id=${encodeURIComponent(course.id)}`;

    return `
      <a href="${detailsUrl}"
         class="group block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-gold hover:shadow-md">
        <article class="flex h-full flex-col justify-between">
          <div>
            <div class="flex items-center justify-between gap-3">
              <span class="rounded-lg px-2.5 py-1 text-[11px] font-bold ${statusClass(course.status)}">
                ${courseStatusText(course.status)}
              </span>
              <span class="text-[11px] text-slate-400">
                ${Number(course.department_nominations_count || 0)} مرشح
              </span>
            </div>
            <p class="mt-5 text-[11px] font-semibold text-brand-gold">
              ${course.course_type === 'MISSION' ? 'مهمة' : 'دورة تدريبية'}
            </p>
            <h4 class="mt-1 text-sm font-bold text-slate-900 transition group-hover:text-brand-gold">
              ${escapeHtml(course.title)}
            </h4>
            <p class="mt-2 line-clamp-2 text-xs leading-6 text-slate-500">
              ${escapeHtml(course.description || 'لا يوجد وصف للدورة.')}
            </p>
          </div>
          <div class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
            <span class="text-[11px] text-slate-500">البدء: ${formatDate(course.start_date)}</span>
            <span class="text-xs font-bold text-slate-800 transition group-hover:text-brand-gold">التفاصيل ←</span>
          </div>
        </article>
      </a>
    `;
  }).join('');
}


async function loadCourses() {
  const query = new URLSearchParams({
    page: '1',
    limit: String(state.limit),
  });

  const search = document.querySelector('#courseSearchInput').value.trim();
  const type = document.querySelector('#courseTypeFilter').value;
  const status = document.querySelector('#courseStatusFilter').value;

  if (search) query.set('search', search);
  if (type) query.set('type', type);
  if (status) query.set('status', status);

  const data = await api(`/api/courses?${query}`);

  const courses = data.courses || [];
  const pagination = data.pagination || {
    page: 1,
    totalPages: 1,
    total: courses.length,
  };

  document.querySelector('#coursesCountText').textContent =
    `إجمالي الدورات: ${pagination.total}`;

  renderCourses(courses);
}

async function initialize() {
  const user = await protectPage(['DEPARTMENT_MANAGER']);
  if (!user) return;
  bindLiveFilters('#coursesFiltersForm', () => {
    loadCourses().catch(showError);
  });

  setIdentity(user);

  document.querySelector('#logoutButton').onclick = logout;

  document.querySelector('#coursesFiltersForm').onsubmit = (event) => {
    event.preventDefault();
    loadCourses().catch(showError);
  };

  document.querySelector('#resetCoursesFiltersButton').onclick = () => {
    document.querySelector('#coursesFiltersForm').reset();
    loadCourses().catch(showError);
  };

  await loadCourses().catch(showError);
}

function showError(error) {
  document.querySelector('#coursesGrid').innerHTML = `
    <div class="rounded-xl border border-rose-200 bg-rose-50 px-5 py-10 text-center text-xs text-rose-700 md:col-span-2 xl:col-span-3">
      ${escapeHtml(error.message || 'تعذر تحميل الدورات.')}
    </div>
  `;
}

initialize();
