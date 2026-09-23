import { protectPage } from '../shared/auth-guard.js';
import { courseStatusText } from '../shared/status-labels.js';
import {
  api,
  escapeHtml,
  formatDate,
  logout,
} from './manage-courses/course-api.js';

function formatCurrentDate() {
  return new Intl.DateTimeFormat('ar-YE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function courseTypeText(type) {
  return type === 'MISSION'
    ? 'مهمة / بعثة'
    : 'دورة تدريبية';
}

function notificationColor(notification) {
  if (!notification.is_read) {
    return 'border-brand-gold/40 bg-brand-lightGold/40';
  }

  return 'border-slate-200 bg-slate-50';
}

function renderRecentCourses(courses) {
  const body = document.querySelector('#recentCoursesTableBody');

  if (!courses.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="py-10 text-center text-xs text-slate-400">
          لا توجد دورات أو مهام مسجلة حتى الآن.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = courses.slice(0, 3).map((course) => `
    <tr class="hover:bg-slate-50">
      <td class="py-3 font-semibold text-slate-700">
        ${escapeHtml(course.course_no)}
      </td>

      <td class="py-3 font-bold text-slate-900">
        ${escapeHtml(course.title)}
      </td>

      <td class="py-3 text-slate-600">
        ${escapeHtml(courseTypeText(course.course_type))}
      </td>

      <td class="py-3">
        <span class="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
          ${escapeHtml(courseStatusText(course.status))}
        </span>
      </td>

      <td class="py-3 text-slate-500">
        ${formatDate(course.start_date)}
      </td>

      <td class="py-3">
        <a
          href="./manage-courses/manage-course.html?id=${course.id}"
          class="rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold transition hover:bg-brand-lightGold"
        >
          التفاصيل
        </a>
      </td>
    </tr>
  `).join('');
}

function renderNotifications(notifications) {
  const container = document.querySelector('#importantNotificationsList');

  if (!notifications.length) {
    container.innerHTML = `
      <p class="rounded-lg bg-slate-50 px-3 py-5 text-center text-xs text-slate-400">
        لا توجد إشعارات حاليًا.
      </p>
    `;
    return;
  }

  container.innerHTML = notifications.slice(0, 2).map((notification) => `
    <a
      href="./notifications.html"
      class="block rounded-lg border px-3 py-2.5 transition hover:border-brand-gold ${notificationColor(notification)}"
    >
      <div class="flex items-start justify-between gap-3">
        <p class="text-xs font-bold text-slate-800">
          ${escapeHtml(notification.title)}
        </p>

        ${
          notification.is_read
            ? ''
            : `
              <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-gold"></span>
            `
        }
      </div>

      <p class="mt-1 line-clamp-1 text-[11px] leading-5 text-slate-500">
        ${escapeHtml(notification.message)}
      </p>

      <p class="mt-1 text-[10px] text-slate-400">
        ${formatDate(notification.created_at)}
      </p>
    </a>
  `).join('');
}

function setSummary(summary) {
  document.querySelector('#activeCoursesCount').textContent =
    summary.activeCourses;

  document.querySelector('#activeCandidatesCount').textContent =
    summary.activeCandidates;

  document.querySelector('#pendingReviewCount').textContent =
    summary.pendingReview;

  document.querySelector('#unreadNotificationsCount').textContent =
    summary.unreadNotifications;

  const badge = document.querySelector('#notificationsBadge');

  if (summary.unreadNotifications > 0) {
    badge.textContent =
      summary.unreadNotifications > 99
        ? '99+'
        : summary.unreadNotifications;

    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function loadDashboard() {
  const data = await api('/api/dashboard');

  setSummary(data.summary);
  renderRecentCourses(data.recentCourses || []);
  renderNotifications(data.importantNotifications || []);
}

function showDashboardError(message) {
  document.querySelector('#recentCoursesTableBody').innerHTML = `
    <tr>
      <td colspan="6" class="py-10 text-center text-xs text-rose-600">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;

  document.querySelector('#importantNotificationsList').innerHTML = `
    <p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-4 text-center text-xs text-rose-700">
      ${escapeHtml(message)}
    </p>
  `;
}

async function initialize() {
  const user = await protectPage(['COURSE_MANAGER']);

  if (!user) return;

  document.querySelector('#currentDate').textContent =
    formatCurrentDate();

  document.querySelector('#currentUserName').textContent =
    user.full_name || user.username || 'مدير الدورة';

  document.querySelector('#logoutButton').addEventListener(
    'click',
    logout
  );

  try {
    await loadDashboard();
  } catch (error) {
    console.error('Course manager dashboard error:', error);

    showDashboardError(
      error.message || 'تعذر تحميل لوحة التحكم.'
    );
  }
}

initialize();
