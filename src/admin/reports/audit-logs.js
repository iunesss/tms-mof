import { protectPage } from '../../shared/auth-guard.js';
import {
  api,
  escapeHtml,
  formatDate,
} from '../manage-courses/course-api.js';

const state = { page: 1, totalPages: 1 };

const eventLabels = {
  USER_CREATED: 'إنشاء مستخدم',
  USER_UPDATED: 'تعديل مستخدم',
  USER_SOFT_DELETED: 'حذف مستخدم',
  COURSE_CREATED: 'إنشاء دورة أو مهمة',
  COURSE_UPDATED: 'تعديل دورة أو مهمة',
  CANDIDATE_STATUS_CHANGED: 'تغيير حالة مرشح',
  MISSION_CANDIDATE_ADDED: 'إضافة مرشح للمهمة',
  CANDIDATE_DOCUMENT_APPROVED: 'اعتماد مستند مرشح',
  CANDIDATE_DOCUMENT_RESUBMISSION_REQUESTED: 'طلب إعادة رفع مستند',
};

function eventText(eventType) {
  return eventLabels[eventType] || eventType || 'عملية نظام';
}

function entityText(entityType) {
  const labels = {
    COURSE: 'دورة أو مهمة',
    COURSES: 'دورة أو مهمة',
    USER: 'مستخدم',
    USERS: 'مستخدم',
    CANDIDATE: 'مرشح',
    CANDIDATE_DOCUMENT: 'مستند مرشح',
    FILE: 'ملف',
    NOMINATION: 'ترشيح',
  };

  return labels[String(entityType || '').toUpperCase()] || entityType || '—';
}

function formatJson(value) {
  if (!value) return '—';

  try {
    return JSON.stringify(
      typeof value === 'string' ? JSON.parse(value) : value,
      null,
      2
    );
  } catch {
    return String(value);
  }
}

function buildQuery() {
  const params = new URLSearchParams({
    page: state.page,
    limit: 15,
  });

  const search = document.querySelector('#auditSearch').value.trim();
  const eventType = document.querySelector('#auditEventType').value;
  const entityType = document.querySelector('#auditEntityType').value;
  const date = document.querySelector('#auditDate').value;

  if (search) params.set('search', search);
  if (eventType) params.set('eventType', eventType);
  if (entityType) params.set('entityType', entityType);
  if (date) params.set('date', date);

  return params.toString();
}

function openDetails(log) {
  document.querySelector('#auditDetailsSubtitle').textContent =
    `${eventText(log.event_type)} — ${formatDate(log.created_at)}`;

  document.querySelector('#auditBeforeData').textContent =
    formatJson(log.before_data);

  document.querySelector('#auditAfterData').textContent =
    formatJson(log.after_data);

  const modal = document.querySelector('#auditDetailsModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function renderLogs(logs) {
  const body = document.querySelector('#auditLogsTableBody');

  if (!logs.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-10 text-center text-xs text-slate-400">
          لا توجد عمليات مطابقة.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = logs.map((log, index) => `
    <tr class="hover:bg-slate-50">
      <td class="px-5 py-3">${formatDate(log.created_at)}</td>
      <td class="px-5 py-3 font-semibold">${escapeHtml(log.actor_full_name || log.actor_username || 'النظام')}</td>
      <td class="px-5 py-3">${escapeHtml(eventText(log.event_type))}</td>
      <td class="px-5 py-3">${escapeHtml(entityText(log.entity_type))}</td>
      <td class="px-5 py-3">${log.entity_id || '—'}</td>
      <td class="max-w-xs truncate px-5 py-3 text-slate-500">${escapeHtml(log.actor_username || '—')}</td>
      <td class="px-5 py-3">
        <button data-log-index="${index}" class="show-audit-details rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold hover:bg-brand-lightGold">
          التفاصيل
        </button>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('.show-audit-details').forEach((button) => {
    button.addEventListener('click', () => {
      openDetails(logs[Number(button.dataset.logIndex)]);
    });
  });
}

function renderPagination(pagination) {
  state.totalPages = pagination.totalPages;

  document.querySelector('#auditLogsTotal').textContent =
    `إجمالي العمليات: ${pagination.total}`;

  document.querySelector('#auditLogsPageInfo').textContent =
    `صفحة ${pagination.page} من ${pagination.totalPages}`;

  document.querySelector('#auditLogsPaginationText').textContent =
    `صفحة ${pagination.page} من ${pagination.totalPages}`;

  document.querySelector('#previousAuditPageButton').disabled =
    pagination.page <= 1;

  document.querySelector('#nextAuditPageButton').disabled =
    pagination.page >= pagination.totalPages;
}

async function loadLogs() {
  try {
    const data = await api(`/api/admin/reports/audit-logs?${buildQuery()}`);
    renderLogs(data.logs || []);
    renderPagination(data.pagination);
  } catch (error) {
    document.querySelector('#auditLogsTableBody').innerHTML = `
      <tr><td colspan="7" class="px-5 py-10 text-center text-xs text-rose-600">
        ${escapeHtml(error.message)}
      </td></tr>
    `;
  }
}

async function loadEventTypes() {
  const data = await api('/api/admin/reports/audit-logs/event-types');
  const select = document.querySelector('#auditEventType');

  select.innerHTML = `
    <option value="">كل العمليات</option>
    ${(data.eventTypes || []).map((type) => `
      <option value="${escapeHtml(type)}">${escapeHtml(eventText(type))}</option>
    `).join('')}
  `;
}

document.querySelector('#searchAuditLogsButton').addEventListener('click', () => {
  state.page = 1;
  loadLogs();
});

document.querySelector('#clearAuditFiltersButton').addEventListener('click', () => {
  document.querySelector('#auditSearch').value = '';
  document.querySelector('#auditEventType').value = '';
  document.querySelector('#auditEntityType').value = '';
  document.querySelector('#auditDate').value = '';
  state.page = 1;
  loadLogs();
});

document.querySelector('#previousAuditPageButton').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadLogs();
  }
});

document.querySelector('#nextAuditPageButton').addEventListener('click', () => {
  if (state.page < state.totalPages) {
    state.page += 1;
    loadLogs();
  }
});

document.querySelector('#closeAuditDetailsModalButton').addEventListener('click', () => {
  const modal = document.querySelector('#auditDetailsModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
});

async function initialize() {
  const session = await protectPage(['SUPER_ADMIN']);
  if (!session) return;

  await loadEventTypes();
  await loadLogs();
}

initialize();