import { protectPage } from '../shared/auth-guard.js';

import {
  api,
  escapeHtml,
  formatDate,
  courseStatusText,
  logout,
  setAgentIdentity,
  loadNotificationsBadge,
} from './agent-api.js';

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
  const body = document.querySelector('#sectorCoursesTableBody');

  if (!courses.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="px-5 py-10 text-center text-xs text-slate-400">
          لا توجد دورات مدعومة لقطاعك حاليًا.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = courses
    .map(
      (course) => `
        <tr class="hover:bg-slate-50">
          <td class="px-5 py-2">
            <p class="font-bold text-slate-800">${escapeHtml(course.title)}</p>
            <p class="mt-1 text-[10px] text-slate-400">
              ${escapeHtml(course.course_no || '—')}
            </p>
          </td>

          <td class="px-5 py-2 text-slate-600">
            ${courseTypeText(course.course_type)}
          </td>

          <td class="px-5 py-2">
            <span class="rounded-lg px-2 py-1 text-[10px] font-bold ${statusClass(course.status)}">
              ${courseStatusText(course.status)}
            </span>
          </td>

          <td class="px-5 py-2 font-bold text-slate-700">
            ${Number(course.pending_nominations || 0)}
          </td>

          <td class="px-5 py-2">
            <a
              href="./manage-courses/course-info.html?id=${encodeURIComponent(course.id)}"
              class="text-[11px] font-bold text-brand-darkGold hover:underline"
            >
              فتح الدورة ←
            </a>
          </td>
        </tr>
      `
    )
    .join('');
}

function renderNotifications(notifications) {
  const container = document.querySelector('#recentNotificationsList');

  if (!notifications.length) {
    container.innerHTML = `
      <div class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center">
        <p class="text-xs text-slate-400">لا توجد إشعارات حديثة.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = notifications
    .map(
      (notification) => `
        <article class="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
          <div class="flex items-start gap-2">
            <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              notification.is_read ? 'bg-slate-300' : 'bg-brand-gold'
            }"></span>

            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-800">
                ${escapeHtml(notification.title)}
              </p>

              <p class="mt-1 line-clamp-1 text-[11px] leading-5 text-slate-500">
                ${escapeHtml(notification.message)}
              </p>

              <p class="mt-1 text-[10px] text-slate-400">
                ${formatDate(notification.created_at)}
              </p>
            </div>
          </div>
        </article>
      `
    )
    .join('');
}

async function loadDashboard() {
  const data = await api('/api/dashboard');

  const summary = data.summary || {};

  document.querySelector('#sectorName').textContent =
    data.sector?.name || '—';

  document.querySelector('#sectorEmployeesCount').textContent =
    summary.sectorEmployees ?? 0;

  document.querySelector('#sectorCoursesCount').textContent =
    summary.sectorCourses ?? 0;

  document.querySelector('#pendingNominationsCount').textContent =
    summary.pendingNominations ?? 0;

  document.querySelector('#unreadNotificationsCount').textContent =
    summary.unreadNotifications ?? 0;

  const coursesWithPendingNominations = (data.recentCourses || []).filter(
    (course) => Number(course.pending_nominations || 0) > 0
  );
  const pendingNominationsLink = document.querySelector('#pendingNominationsLink');

  if (coursesWithPendingNominations.length === 1) {
    pendingNominationsLink.href =
      `./manage-courses/course-info.html?id=${encodeURIComponent(coursesWithPendingNominations[0].id)}`;
  } else {
    pendingNominationsLink.href = './manage-courses/main-courses.html';
  }

  renderCourses((data.recentCourses || []).slice(0, 3));
  renderNotifications((data.recentNotifications || []).slice(0, 3));
}

async function initialize() {
  const user = await protectPage(['AGENT']);

  if (!user) return;

  setAgentIdentity(user);

  document.querySelector('#logoutButton').addEventListener('click', logout);

  try {
    await Promise.all([
      loadDashboard(),
      loadNotificationsBadge(),
    ]);
  } catch (error) {
    console.error('Agent dashboard error:', error);

    document.querySelector('#sectorCoursesTableBody').innerHTML = `
      <tr>
        <td colspan="5" class="px-5 py-10 text-center text-xs text-rose-600">
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;
  }
}

initialize();
