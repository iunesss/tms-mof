import { protectPage } from '../shared/auth-guard.js';
import { notify } from '../shared/notify.js';

const state = {
  page: 1,
  totalPages: 1,
};

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateTime(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ar-YE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
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

function getNotificationIcon(category) {
  const icons = {
    COURSES: '📚',
    FORMS: '📝',
    GENERAL: '🔔',
  };

  return icons[category] || '🔔';
}

function renderNotifications(notifications) {
  const container = document.querySelector('#notificationsList');

  if (!notifications.length) {
    container.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-xs text-slate-400">
        لا توجد إشعارات مطابقة.
      </div>
    `;
    return;
  }

  container.innerHTML = notifications.map((notification) => `
    <article
      data-notification-id="${notification.id}"
      class="notification-item cursor-pointer rounded-xl border p-4 transition hover:border-brand-gold ${
        notification.is_read
          ? 'border-slate-200 bg-white'
          : 'border-brand-gold/30 bg-brand-lightGold/30'
      }"
    >
      <div class="flex items-start gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-lg shadow-sm">
          ${getNotificationIcon(notification.category)}
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-xs font-bold text-slate-900">
              ${escapeHtml(notification.title)}
            </h4>

            ${
              !notification.is_read
                ? '<span class="rounded-full bg-brand-gold px-2 py-0.5 text-[9px] font-bold text-white">جديد</span>'
                : ''
            }
          </div>

          <p class="mt-2 text-xs leading-6 text-slate-600">
            ${escapeHtml(notification.message)}
          </p>

          <p class="mt-2 text-[10px] text-slate-400">
            ${formatDateTime(notification.created_at)}
          </p>
        </div>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('.notification-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const notificationId = Number(item.dataset.notificationId);
      const notification = notifications.find(
        (entry) => Number(entry.id) === notificationId
      );

      if (!notification || notification.is_read) return;

      try {
        await api(
          `/api/notifications/${notificationId}/read`,
          { method: 'PATCH' }
        );

        await loadNotifications();
      } catch {
        // لا نوقف الواجهة إذا فشل التعليم كمقروء.
      }
    });
  });
}

function renderPagination(pagination, unreadCount) {
  state.totalPages = pagination.totalPages || 1;

  document.querySelector('#notificationsPageInfo').textContent =
    `إجمالي النتائج: ${pagination.total || 0}`;

  document.querySelector('#unreadNotificationsLabel').textContent =
    unreadCount
      ? `${unreadCount} غير مقروء`
      : 'لا توجد إشعارات جديدة';

  document.querySelector('#notificationsPaginationText').textContent =
    `صفحة ${pagination.page} من ${pagination.totalPages || 1}`;

  document.querySelector('#previousNotificationsPageButton').disabled =
    pagination.page <= 1;

  document.querySelector('#nextNotificationsPageButton').disabled =
    pagination.page >= pagination.totalPages;

  setBadge(Number(unreadCount || 0));
}

async function loadNotifications() {
  const params = new URLSearchParams({
    page: String(state.page),
    limit: '10',
  });

  const readStatus = document.querySelector('#notificationReadFilter').value;
  const category = document.querySelector('#notificationCategoryFilter').value;
  const search = document.querySelector('#notificationSearchInput').value.trim();

  if (readStatus) params.set('readStatus', readStatus);
  if (category) params.set('category', category);
  if (search) params.set('search', search);

  const data = await api(`/api/notifications?${params}`);

  if (!data) return;

  renderNotifications(data.notifications || []);
  renderPagination(data.pagination || {}, data.unreadCount || 0);
}

async function initialize() {
  const user = await protectPage(['EMPLOYEE']);
  if (!user) return;

  document.querySelector('#currentUserName').textContent =
    user.fullName || user.full_name || user.username || 'الموظف';

  document.querySelector('#logoutButton').addEventListener('click', logout);

  document.querySelector('#applyNotificationsFiltersButton').addEventListener(
    'click',
    () => {
      state.page = 1;
      loadNotifications();
    }
  );

  document.querySelector('#clearNotificationFiltersButton').addEventListener(
    'click',
    () => {
      document.querySelector('#notificationReadFilter').value = '';
      document.querySelector('#notificationCategoryFilter').value = '';
      document.querySelector('#notificationSearchInput').value = '';
      state.page = 1;
      loadNotifications();
    }
  );

  document.querySelector('#previousNotificationsPageButton').addEventListener(
    'click',
    () => {
      if (state.page > 1) {
        state.page -= 1;
        loadNotifications();
      }
    }
  );

  document.querySelector('#nextNotificationsPageButton').addEventListener(
    'click',
    () => {
      if (state.page < state.totalPages) {
        state.page += 1;
        loadNotifications();
      }
    }
  );

  document.querySelector('#markAllNotificationsReadButton').addEventListener(
    'click',
    async () => {
      try {
        await api('/api/notifications/read-all', {
          method: 'PATCH',
        });

        await loadNotifications();
        notify('تم تحديد جميع الإشعارات كمقروءة.', 'success');
      } catch (error) {
        notify(error.message);
      }
    }
  );

  try {
    await loadNotifications();
  } catch (error) {
    document.querySelector('#notificationsList').innerHTML = `
      <p class="py-10 text-center text-xs text-rose-600">
        ${escapeHtml(error.message)}
      </p>
    `;
  }
}

initialize();
