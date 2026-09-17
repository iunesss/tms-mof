import { protectPage } from '../shared/auth-guard.js';

const state = {
  page: 1,
  limit: 12,
  totalPages: 1,
};

let searchTimer;

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
    throw new Error(
      data.message || 'حدث خطأ أثناء الاتصال بالخادم.'
    );
  }

  return data;
}

async function logout() {
  try {
    await api('/api/auth/logout', {
      method: 'POST',
    });
  } finally {
    window.location.replace('/src/login/index.html');
  }
}

function categoryLabel(category) {
  const labels = {
    NOMINATIONS: 'الترشيحات',
    COURSES: 'الدورات والمهام',
    DOCUMENTS: 'المستندات والنماذج',
    GENERAL: 'إشعار عام',
  };

  return labels[category] || 'إشعار عام';
}

function categoryClass(category) {
  const classes = {
    NOMINATIONS: 'border-violet-100 bg-violet-50 text-violet-700',
    COURSES: 'border-brand-gold/30 bg-brand-lightGold text-brand-darkGold',
    DOCUMENTS: 'border-blue-100 bg-blue-50 text-blue-700',
    GENERAL: 'border-slate-200 bg-slate-100 text-slate-600',
  };

  return classes[category] || classes.GENERAL;
}

function setUnreadCount(total) {
  const badge = document.querySelector('#notificationsBadge');
  const label = document.querySelector('#unreadNotificationsLabel');

  label.textContent =
    total > 0
      ? `لديك ${total} إشعار غير مقروء`
      : 'لا توجد إشعارات غير مقروءة';

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
      <div class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-xs text-slate-400">
        لا توجد إشعارات مطابقة للفلاتر المحددة.
      </div>
    `;
    return;
  }

  container.innerHTML = notifications.map((notification) => `
    <article
      data-notification-id="${notification.id}"
      class="notification-card cursor-pointer rounded-xl border p-4 shadow-sm transition hover:border-brand-gold hover:shadow-md ${
        notification.is_read
          ? 'border-slate-200 bg-white'
          : 'border-brand-gold/40 bg-brand-lightGold/30'
      }"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-3">
          <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            notification.is_read ? 'bg-slate-300' : 'bg-brand-gold'
          }"></span>

          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border px-2.5 py-1 text-[10px] font-bold ${categoryClass(notification.category)}">
                ${escapeHtml(categoryLabel(notification.category))}
              </span>

              ${
                notification.is_read
                  ? ''
                  : `
                    <span class="rounded-full bg-brand-navy px-2 py-1 text-[10px] font-bold text-white">
                      جديد
                    </span>
                  `
              }
            </div>

            <h3 class="mt-3 text-sm font-bold text-slate-900">
              ${escapeHtml(notification.title)}
            </h3>

            <p class="mt-1.5 text-xs leading-6 text-slate-600">
              ${escapeHtml(notification.message)}
            </p>

            <p class="mt-3 text-[11px] text-slate-500">
              من:
              <span class="font-semibold text-slate-700">
                ${escapeHtml(notification.sender_name || 'النظام')}
              </span>
            </p>
          </div>
        </div>

        <span class="shrink-0 text-[10px] text-slate-400">
          ${formatDate(notification.created_at)}
        </span>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('.notification-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const notificationId = card.dataset.notificationId;

      try {
        await api(
          `/api/manager/notifications/${notificationId}/read`,
          { method: 'PATCH' }
        );

        await loadNotifications();
      } catch (error) {
        console.error('Manager read notification error:', error);
      }
    });
  });
}

function renderPagination(pagination) {
  state.totalPages = pagination.totalPages || 1;

  document.querySelector('#notificationsPageInfo').textContent =
    `إجمالي الإشعارات: ${pagination.total || 0}`;

  document.querySelector('#notificationsPaginationText').textContent =
    `صفحة ${pagination.page} من ${state.totalPages}`;

  document.querySelector('#previousNotificationsPageButton').disabled =
    pagination.page <= 1;

  document.querySelector('#nextNotificationsPageButton').disabled =
    pagination.page >= state.totalPages;
}

async function loadNotifications() {
  const query = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
  });

  const category = document.querySelector(
    '#notificationCategoryFilter'
  ).value;

  const readStatus = document.querySelector(
    '#notificationReadFilter'
  ).value;

  const search = document.querySelector(
    '#notificationSearchInput'
  ).value.trim();

  if (category) query.set('category', category);
  if (readStatus) query.set('readStatus', readStatus);
  if (search) query.set('search', search);

  const data = await api(
    `/api/manager/notifications?${query.toString()}`
  );

  renderNotifications(data.notifications || []);
  renderPagination(data.pagination || {});
  setUnreadCount(Number(data.unreadCount || 0));
}

async function markAllAsRead() {
  const button = document.querySelector(
    '#markAllNotificationsReadButton'
  );

  button.disabled = true;
  button.textContent = 'جارٍ التحديث...';

  try {
    await api('/api/manager/notifications/read-all', {
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

async function initialize() {
  const user = await protectPage(['DEPARTMENT_MANAGER']);

  if (!user) return;

  document.querySelector('#currentUserName').textContent =
    user.fullName || user.full_name || user.username || 'مدير القسم';

  document.querySelector('#logoutButton').addEventListener(
    'click',
    logout
  );

  document.querySelector(
    '#markAllNotificationsReadButton'
  ).addEventListener('click', markAllAsRead);

  document.querySelector(
    '#clearNotificationFiltersButton'
  ).addEventListener('click', () => {
    document.querySelector('#notificationCategoryFilter').value = '';
    document.querySelector('#notificationReadFilter').value = '';
    document.querySelector('#notificationSearchInput').value = '';

    state.page = 1;
    loadNotifications();
  });

  document.querySelector(
    '#notificationCategoryFilter'
  ).addEventListener('change', () => {
    state.page = 1;
    loadNotifications();
  });

  document.querySelector(
    '#notificationReadFilter'
  ).addEventListener('change', () => {
    state.page = 1;
    loadNotifications();
  });

  document.querySelector(
    '#notificationSearchInput'
  ).addEventListener('input', () => {
    clearTimeout(searchTimer);

    searchTimer = setTimeout(() => {
      state.page = 1;
      loadNotifications();
    }, 350);
  });

  document.querySelector(
    '#previousNotificationsPageButton'
  ).addEventListener('click', () => {
    if (state.page <= 1) return;

    state.page -= 1;
    loadNotifications();
  });

  document.querySelector(
    '#nextNotificationsPageButton'
  ).addEventListener('click', () => {
    if (state.page >= state.totalPages) return;

    state.page += 1;
    loadNotifications();
  });

  try {
    await loadNotifications();
  } catch (error) {
    console.error('Manager notifications error:', error);

    document.querySelector('#notificationsList').innerHTML = `
      <div class="rounded-xl border border-rose-200 bg-rose-50 px-5 py-10 text-center text-xs text-rose-700">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

initialize();