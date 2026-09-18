import { protectPage } from '../shared/auth-guard.js';

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
  const labels = {
    ACTIVE: 'نشطة',
    CANDIDATE_PROCESSING: 'قيد معالجة المرشحين',
    OPEN_FOR_NOMINATION: 'مفتوحة للترشيح',
    NOMINATION_CLOSED: 'أُغلق الترشيح',
  };

  return labels[status] || status || '—';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    window.location.replace('/src/login/index.html');
    return null;
  }

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

function setBadge(total) {
  const badge = document.querySelector('#notificationsBadge');

  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderCourses(courses) {
  const grid = document.querySelector('#coursesGrid');

  document.querySelector('#coursesCountText').textContent =
    `إجمالي الدورات الحالية: ${courses.length}`;

  if (!courses.length) {
    grid.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
        لا توجد دورات حالية مقبولة لك.
      </div>
    `;
    return;
  }

  grid.innerHTML = courses.map((course) => `
    <article class="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-gold hover:shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <span class="rounded-lg bg-brand-lightGold px-2.5 py-1 text-[10px] font-bold text-brand-darkGold">
          ${course.course_type === 'MISSION' ? 'مهمة / بعثة' : 'دورة تدريبية'}
        </span>

        <span class="rounded-lg bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
          ${courseStatusText(course.status)}
        </span>
      </div>

      <p class="mt-5 text-[11px] font-semibold text-slate-400">
        ${escapeHtml(course.course_no || 'بدون رقم')}
      </p>

      <h3 class="mt-1 text-sm font-bold text-slate-900">
        ${escapeHtml(course.title)}
      </h3>

      <p class="mt-2 line-clamp-2 text-xs leading-6 text-slate-500">
        ${escapeHtml(course.description || 'لا يوجد وصف للدورة.')}
      </p>

      <div class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <span class="text-[11px] text-slate-500">
          البداية: ${formatDate(course.start_date)}
        </span>

        <a href="./course-info.html?id=${encodeURIComponent(course.id)}" class="text-xs font-bold text-brand-darkGold hover:underline">
          التفاصيل ←
        </a>
      </div>
    </article>
  `).join('');
}

async function initialize() {
  const user = await protectPage(['EMPLOYEE']);
  if (!user) return;

  document.querySelector('#currentUserName').textContent =
    user.fullName || user.full_name || user.username || 'الموظف';

  document.querySelector('#logoutButton').addEventListener('click', logout);

  try {
    const data = await api('/api/employee/courses');
    if (!data) return;

    renderCourses(data.courses || []);
    setBadge(Number(data.unreadCount || 0));
  } catch (error) {
    document.querySelector('#coursesGrid').innerHTML = `
      <div class="rounded-xl border border-rose-200 bg-rose-50 px-5 py-8 text-center text-xs text-rose-700 md:col-span-2 xl:col-span-3">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

initialize();