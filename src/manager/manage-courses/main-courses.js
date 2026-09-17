import { protectPage } from '../../shared/auth-guard.js';

const state = { page: 1, limit: 9 };

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

function courseStatusText(status) {
  const statuses = {
    OPEN_FOR_NOMINATION: 'مفتوحة للترشيح',
    NOMINATION_CLOSED: 'أُغلق الترشيح',
    CANDIDATE_PROCESSING: 'قيد معالجة المرشحين',
    ACTIVE: 'نشطة',
  };

  return statuses[status] || status || '—';
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

  grid.innerHTML = courses.map((course) => `
    <article class="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-gold hover:shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <span class="rounded-lg bg-brand-lightGold px-2.5 py-1 text-[11px] font-bold text-brand-darkGold">
          ${course.course_type === 'MISSION' ? 'مهمة / بعثة' : 'دورة تدريبية'}
        </span>

        <span class="rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
          ${courseStatusText(course.status)}
        </span>
      </div>

      <h4 class="mt-5 text-sm font-bold text-slate-900">
        ${escapeHtml(course.title)}
      </h4>

      <p class="mt-1 text-[11px] text-slate-500">
        رقم الدورة: ${escapeHtml(course.course_no || '—')}
      </p>

      <p class="mt-3 line-clamp-2 text-xs leading-6 text-slate-500">
        ${escapeHtml(course.description || 'لا يوجد وصف للدورة.')}
      </p>

      <div class="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3 text-[11px]">
        <div>
          <p class="text-slate-400">ترشيحات القسم</p>
          <p class="mt-1 font-bold text-slate-800">
            ${Number(course.department_nominations_count || 0)}
          </p>
        </div>

        <div>
          <p class="text-slate-400">حالة الإرسال</p>
          <p class="mt-1 font-bold text-slate-800">
            ${course.submission_locked ? 'تم الإرسال' : 'قابل للتعديل'}
          </p>
        </div>
      </div>

      <p class="mt-3 text-[11px] text-slate-500">
        البداية: ${formatDate(course.start_date)}
      </p>

      <a
        href="./course-info.html?id=${encodeURIComponent(course.id)}"
        class="mt-4 block rounded-lg bg-brand-navy px-3 py-2 text-center text-[11px] font-bold text-white transition hover:bg-slate-700"
      >
        فتح تفاصيل الدورة
      </a>
    </article>
  `).join('');
}

function renderPagination(pagination) {
  const totalPages = pagination.totalPages || 1;
  const element = document.querySelector('#coursesPagination');

  element.innerHTML = `
    <p class="text-slate-500">
      صفحة ${pagination.page} من ${totalPages}
      <span class="mr-2 text-[11px] text-slate-400">(${pagination.total} دورة)</span>
    </p>

    <div class="flex gap-2">
      <button id="previousCoursesPageButton" type="button" ${pagination.page <= 1 ? 'disabled' : ''} class="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50">
        السابق
      </button>

      <button id="nextCoursesPageButton" type="button" ${pagination.page >= totalPages ? 'disabled' : ''} class="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50">
        التالي
      </button>
    </div>
  `;

  document.querySelector('#previousCoursesPageButton').onclick = () => {
    if (state.page > 1) {
      state.page -= 1;
      loadCourses();
    }
  };

  document.querySelector('#nextCoursesPageButton').onclick = () => {
    if (state.page < totalPages) {
      state.page += 1;
      loadCourses();
    }
  };
}

async function loadCourses() {
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

  const data = await api(`/api/manager/courses?${query}`);

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
}

async function initialize() {
  const user = await protectPage(['DEPARTMENT_MANAGER']);
  if (!user) return;

  setIdentity(user);

  document.querySelector('#logoutButton').onclick = logout;

  document.querySelector('#coursesFiltersForm').onsubmit = (event) => {
    event.preventDefault();
    state.page = 1;
    loadCourses().catch(showError);
  };

  document.querySelector('#resetCoursesFiltersButton').onclick = () => {
    document.querySelector('#coursesFiltersForm').reset();
    state.page = 1;
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