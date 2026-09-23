export async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'حدث خطأ أثناء الاتصال بالخادم.');
  }

  return data;
}

export function getQuery(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function escapeHtml(value) {
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

export { courseStatusText, candidateStatusText } from '../../shared/status-labels.js';

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('/src/login/index.html');
  }
}
