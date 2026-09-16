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

export function courseStatusText(status) {
  const statuses = {
    DRAFT: 'مسودة',
    ACTIVE: 'نشطة',
    COMPLETED: 'مكتملة',
    ARCHIVED: 'مؤرشفة',
    CANCELLED: 'ملغاة',
  };

  return statuses[status] || status || '—';
}

export function candidateStatusText(status) {
  const statuses = {
    SELECTED: 'تم الاختيار',
    DOCUMENTS_PENDING: 'بانتظار المستندات',
    DOCUMENTS_UNDER_REVIEW: 'تحت مراجعة المستندات',
    PRELIMINARILY_ACCEPTED: 'مقبول مبدئيًا',
    CONFIRMED: 'مؤكد',
    REJECTED: 'مرفوض نهائيًا',
    CANCELLED: 'ملغى',
  };

  return statuses[status] || status || '—';
}

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('../../login/index.html');
  }
}