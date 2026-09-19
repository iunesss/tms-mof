import { protectPage } from '../../shared/auth-guard.js';

import {
  api,
  escapeHtml,
  formatDate,
  courseStatusText,
  logout,
  setAgentIdentity,
  loadNotificationsBadge,
} from '../agent-api.js';

const state = {
  page: 1,
  limit: 9,
};

function courseTypeText(type) {
  return type === 'MISSION' ? 'مهمة / بعثة' : 'دورة تدريبية';
}

function statusClass(status) {
  const classes = {
    OPEN_FOR_NOMINATION: 'bg-blue-50 text-blue-700',
    NOMINATION_CLOSED: 'bg-amber-50 text-amber-700',
    CANDIDATE_PROCESSING: 'bg-violet-50 text-violet-700',
    ACTIVE: 'bg-emerald-50 text-emerald-700',
  };

  return classes[status] || 'bg-slate-100 text-slate-600';
}

function renderCourses(courses) {
  const grid = document.querySelector('#coursesGrid');

  if (!courses.length) {
    grid.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
        لا توجد دورات أو مهام مدعومة لقطاعك.
      </div>
    `;
    return;
  }

  grid.innerHTML = courses
    .map(
      (course) => `
        <article class="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-gold hover:shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <span class="rounded-lg px-2.5 py-1 text-[11px] font-bold ${statusClass(course.status)}">
              ${courseStatusText(course.status)}
            </span>

            <span class="text-[11px] text-slate-400">
              ${Number(course.pending_nominations || 0)} بانتظار المراجعة
            </span>
          </div>

          <p class="mt-5 text-[11px] font-semibold text-brand-gold">
            ${courseTypeText(course.course_type)}
          </p>

          <h4 class="mt-1 text-sm font-bold text-slate-900">
            ${escapeHtml(course.title)}
          </h4>

          <p class="mt-2 line-clamp-2 text-xs leading-6 text-slate-500">
            ${escapeHtml(course.description || 'لا يوجد وصف للدورة.')}
          </p>

          <div class="mt-5 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
            <p>البداية: ${formatDate(course.start_date)}</p>
            <p class="mt-1">النهاية: ${formatDate(course.end_date)}</p>
          </div>

          <a
            href="./course-info.html?id=${encodeURIComponent(course.id)}"
            class="mt-4 block rounded-lg bg-brand-navy px-3 py-2 text-center text-[11px] font-bold text-white transition hover:bg-slate-700"
          >
            مراجعة الترشيحات
          </a>
        </article>
      `
    )
    .join('');
}

function renderPagination(pagination) {
  const element = document.querySelector('#coursesPagination');
  const totalPages = pagination.totalPages || 1;

  element.innerHTML = `
    <p class="text-slate-500">
      صفحة ${pagination.page} من ${totalPages}
      <span class="mr-2 text-[11px] text-slate-400">
        (${pagination.total} دورة أو مهمة)
      </span>
    </p>

    <div class="flex gap-2">
      <button
        id="previousCoursesPageButton"
        type="button"
        class="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        ${pagination.page <= 1 ? 'disabled' : ''}
      >
        السابق
      </button>

      <button
        id="nextCoursesPageButton"
        type="button"
        class="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        ${pagination.page >= totalPages ? 'disabled' : ''}
      >
        التالي
      </button>
    </div>
  `;

  document
    .querySelector('#previousCoursesPageButton')
    .addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      loadCourses();
    });

  document
    .querySelector('#nextCoursesPageButton')
    .addEventListener('click', () => {
      if (pagination.page >= totalPages) return;
      state.page += 1;
      loadCourses();
    });
}

async function loadCourses() {
  const grid = document.querySelector('#coursesGrid');

  grid.innerHTML = `
    <div class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
      جارٍ تحميل الدورات...
    </div>
  `;

  const query = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
  });

  const search = document.querySelector('#courseSearchInput').value.trim();
  const type = document.querySelector('#courseTypeFilter').value;
  const status = document.querySelector('#courseStatusFilter').value;

  if (search) query.set('search', search);
  if (type) query.set('type', type);
  if (status) query.set('status', status);

  try {
    const data = await api(`/api/courses?${query.toString()}`);

    const courses = data.courses || [];
    const pagination = data.pagination || {
      page: 1,
      totalPages: 1,
      total: courses.length,
    };

    document.querySelector('#coursesCountText').textContent =
      `إجمالي الدورات: ${pagination.total}`;

    renderCourses(courses);
    renderPagination(pagination);
  } catch (error) {
    document.querySelector('#coursesCountText').textContent =
      'تعذر تحميل الدورات';

    grid.innerHTML = `
      <div class="rounded-xl border border-rose-200 bg-rose-50 px-5 py-10 text-center text-xs text-rose-700 md:col-span-2 xl:col-span-3">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

async function initialize() {
  const user = await protectPage(['AGENT']);

  if (!user) return;

  setAgentIdentity(user);

  document.querySelector('#logoutButton').addEventListener('click', logout);

  document
    .querySelector('#coursesFiltersForm')
    .addEventListener('submit', (event) => {
      event.preventDefault();
      state.page = 1;
      loadCourses();
    });

  document
    .querySelector('#resetCoursesFiltersButton')
    .addEventListener('click', () => {
      document.querySelector('#coursesFiltersForm').reset();
      state.page = 1;
      loadCourses();
    });

  await Promise.all([
    loadCourses(),
    loadNotificationsBadge(),
  ]);
}

initialize();
