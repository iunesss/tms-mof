export async function api(url, options = {}) {
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

export function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatDate(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ar-YE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export function getQuery(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export { courseStatusText, nominationStatusText } from '../shared/status-labels.js';

export function setAgentIdentity(user) {
  const userName =
    user?.fullName ||
    user?.full_name ||
    user?.username ||
    'وكيل القطاع';

  document.querySelectorAll('#currentUserName').forEach((element) => {
    element.textContent = userName;
  });

  document.querySelectorAll('#welcomeUserName').forEach((element) => {
    element.textContent = userName;
  });

  document.querySelectorAll('#currentSectorName').forEach((element) => {
    element.textContent = 'وكيل قطاع';
  });
}

export async function logout() {
  try {
    await api('/api/auth/logout', {
      method: 'POST',
    });
  } finally {
    window.location.replace('/src/login/index.html');
  }
}

export async function loadNotificationsBadge() {
  const badges = document.querySelectorAll('#notificationsBadge');

  if (!badges.length) return;

  try {
    const data = await api(
      '/api/notifications?page=1&limit=1&readStatus=UNREAD'
    );

    const unreadCount = Number(data.unreadCount || 0);

    badges.forEach((badge) => {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    });
  } catch {
    badges.forEach((badge) => badge.classList.add('hidden'));
  }
}
