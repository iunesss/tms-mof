import { protectPage } from '../shared/auth-guard.js';
import {
  api,
  escapeHtml,
  formatDate,
  logout,
} from './manage-courses/course-api.js';

const state = {
  page: 1,
  limit: 12,
  totalPages: 1,
};

let searchTimer;

const categoryLabels = {
  DOCUMENTS: 'المستندات والنماذج',
  CANDIDATES: 'المرشحون والترشيحات',
  COURSES: 'الدورات والمهام',
  GENERAL: 'إشعار عام',
};

function categoryClass(category) {
  const styles = {
    DOCUMENTS: 'bg-blue-50 text-blue-700 border-blue-100',
    CANDIDATES: 'bg-violet-50 text-violet-700 border-violet-100',
    COURSES: 'bg-brand-lightGold text-brand-darkGold border-brand-gold/30',
    GENERAL: 'bg-slate-100 text-slate-600 border-slate-200',
  };

  return styles[category] || styles.GENERAL;
}

function setUnreadBadge(total) {
  const badge = document.querySelector('#notificationsBadge');
  const label = document.querySelector('#unreadNotificationsLabel');

  if (label) {
    label.textContent =
      total > 0
        ? `لديك ${total} إشعار غير مقروء`
        : 'لا توجد إشعارات غير مقروءة';
  }

  if (!badge) return;

  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotifications(notifications) {
  const container = document.querySelector('#notificationsList');

  if (!notifications.length) {
    container.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
        <p class="text-sm font-bold text-slate-700">لا توجد إشعارات مطابقة</p>
        <p class="mt-2 text-xs text-slate-500">
          جرّب تغيير الفلاتر أو عد لاحقًا لمراجعة آخر التنبيهات.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = notifications
    .map(
      (notification) => `
        <article
          data-notification-id="${notification.id}"
          class="notification-card cursor-pointer rounded-xl border p-4 shadow-sm transition hover:border-brand-gold hover:shadow-md ${
            notification.is_read
              ? 'border-slate-200 bg-white'
              : 'border-brand-gold/40 bg-brand-lightGold/30'
          }"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3">
              <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                notification.is_read ? 'bg-slate-300' : 'bg-brand-gold'
              }"></span>

              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full border px-2.5 py-1 text-[10px] font-bold ${categoryClass(
                    notification.category
                  )}">
                    ${escapeHtml(categoryLabels[notification.category])}
                  </span>

                  ${
                    !notification.is_read
                      ? `
                        <span class="rounded-full bg-brand-navy px-2 py-1 text-[10px] font-bold text-white">
                          جديد
                        </span>
                      `
                      : ''
                  }
                </div>

                <h3 class="mt-3 text-sm font-bold text-slate-900">
                  ${escapeHtml(notification.title)}
                </h3>

                <p class="mt-1.5 text-xs leading-6 text-slate-600">
                  ${escapeHtml(notification.message)}
                </p>
              </div>
            </div>

            <span class="shrink-0 text-[10px] text-slate-400">
              ${formatDate(notification.created_at)}
            </span>
          </div>

          <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <p class="text-[11px] text-slate-500">
              من:
              <span class="font-semibold text-slate-700">
                ${escapeHtml(notification.sender_name || 'النظام')}
              </span>
            </p>

            <span class="text-[11px] font-bold text-brand-darkGold">
              ${notification.is_read ? 'تمت القراءة' : 'اضغط لقراءة الإشعار'}
            </span>
          </div>
        </article>
      `
    )
    .join('');

  container.querySelectorAll('.notification-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const notificationId = card.dataset.notificationId;
      const notification = notifications.find(
        (item) => String(item.id) === String(notificationId)
      );

      if (!notification || notification.is_read) return;

      try {
        await api(`/api/course-manager/notifications/${notificationId}/read`, {
          method: 'PATCH',
        });

        await loadNotifications();
      } catch (error) {
        console.error('Read notification error:', error);
      }
    });
  });
}

function renderPagination(pagination) {
  state.totalPages = pagination.totalPages || 1;

  document.querySelector('#notificationsPageInfo').textContent =
    `إجمالي الإشعارات: ${pagination.total}`;

  document.querySelector('#notificationsPaginationText').textContent =
    `صفحة ${pagination.page} من ${state.totalPages}`;

  document.querySelector('#previousNotificationsPageButton').disabled =
    pagination.page <= 1;

  document.querySelector('#nextNotificationsPageButton').disabled =
    pagination.page >= state.totalPages;
}

async function loadNotifications() {
  const category = document.querySelector('#notificationCategoryFilter').value;
  const readStatus = document.querySelector('#notificationReadFilter').value;
  const search = document.querySelector('#notificationSearchInput').value.trim();

  const query = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
  });

  if (category) query.set('category', category);
  if (readStatus) query.set('readStatus', readStatus);
  if (search) query.set('search', search);

  const data = await api(
    `/api/course-manager/notifications?${query.toString()}`
  );

  renderNotifications(data.notifications || []);
  renderPagination(data.pagination || {});
  setUnreadBadge(Number(data.unreadCount || 0));
}

async function markAllAsRead() {
  const button = document.querySelector('#markAllNotificationsReadButton');

  button.disabled = true;
  button.textContent = 'جارٍ التحديث...';

  try {
    await api('/api/course-manager/notifications/read-all', {
      method: 'PATCH',
    });

    state.page = 1;
    await loadNotifications();
  } catch (error) {
    alert(error.message || 'تعذر تحديث الإشعارات.');
  } finally {
    button.disabled = false;
    button.textContent = 'تحديد الكل كمقروء';
  }
}

function bindEvents() {
  document
    .querySelector('#markAllNotificationsReadButton')
    .addEventListener('click', markAllAsRead);

  document
    .querySelector('#clearNotificationFiltersButton')
    .addEventListener('click', () => {
      document.querySelector('#notificationCategoryFilter').value = '';
      document.querySelector('#notificationReadFilter').value = '';
      document.querySelector('#notificationSearchInput').value = '';
      state.page = 1;
      loadNotifications();
    });

  document
    .querySelector('#notificationCategoryFilter')
    .addEventListener('change', () => {
      state.page = 1;
      loadNotifications();
    });

  document
    .querySelector('#notificationReadFilter')
    .addEventListener('change', () => {
      state.page = 1;
      loadNotifications();
    });

  document
    .querySelector('#notificationSearchInput')
    .addEventListener('input', () => {
      clearTimeout(searchTimer);

      searchTimer = setTimeout(() => {
        state.page = 1;
        loadNotifications();
      }, 350);
    });

  document
    .querySelector('#previousNotificationsPageButton')
    .addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      loadNotifications();
    });

  document
    .querySelector('#nextNotificationsPageButton')
    .addEventListener('click', () => {
      if (state.page >= state.totalPages) return;
      state.page += 1;
      loadNotifications();
    });

  document.querySelector('#logoutButton').addEventListener('click', logout);
}

async function initialize() {
  const user = await protectPage(['COURSE_MANAGER']);

  if (!user) return;

  const userName = document.querySelector('#currentUserName');

  if (userName) {
    userName.textContent = user.fullName || user.username || 'مدير الدورة';
  }

  bindEvents();

  try {
    await loadNotifications();
  } catch (error) {
    console.error('Notifications error:', error);

    document.querySelector('#notificationsList').innerHTML = `
      <div class="rounded-xl border border-rose-200 bg-rose-50 px-5 py-6 text-center text-xs font-semibold text-rose-700">
        تعذر تحميل الإشعارات. حاول تحديث الصفحة.
      </div>
    `;
  }
}

initialize();