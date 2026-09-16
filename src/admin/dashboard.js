import { protectPage } from '/src/shared/auth-guard.js';

const roleLabels = {
  COURSE_MANAGER: 'مديرو الدورات',
  AGENT: 'وكلاء القطاعات',
  DEPARTMENT_MANAGER: 'مديرو الأقسام',
  EMPLOYEE: 'الموظفون',
};

const roleColors = {
  COURSE_MANAGER: 'bg-violet-500',
  AGENT: 'bg-emerald-500',
  DEPARTMENT_MANAGER: 'bg-brand-gold',
  EMPLOYEE: 'bg-blue-500',
};

function formatDate() {
  return new Intl.DateTimeFormat('ar-YE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function formatDateTime(dateValue) {
  if (!dateValue) return '—';

  return new Intl.DateTimeFormat('ar-YE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateValue));
}

function eventLabel(eventType) {
  const labels = {
    USER_CREATED: 'إنشاء مستخدم',
    USER_UPDATED: 'تعديل مستخدم',
    USER_STATUS_CHANGED: 'تغيير حالة مستخدم',
    COURSE_CREATED: 'إنشاء دورة أو مهمة',
    COURSE_UPDATED: 'تعديل دورة أو مهمة',
    COURSE_STATUS_CHANGED: 'تغيير حالة دورة',
    COURSE_SOFT_DELETED: 'حذف دورة',
    CANDIDATE_CREATED: 'إنشاء مرشح',
    CANDIDATE_STATUS_CHANGED: 'تغيير حالة مرشح',
    ATTACHMENT_SENT: 'إرسال مرفق',
  };

  return labels[eventType] || eventType;
}

function eventClass(eventType) {
  if (eventType.includes('DELETED') || eventType.includes('CANCELLED')) {
    return 'bg-red-50 text-red-700';
  }

  if (eventType.includes('CREATED')) {
    return 'bg-emerald-50 text-emerald-700';
  }

  if (eventType.includes('STATUS')) {
    return 'bg-violet-50 text-violet-700';
  }

  return 'bg-blue-50 text-blue-700';
}

function renderRoleDistribution(distribution) {
  const container = document.querySelector('#roleDistribution');

  const maximum = Math.max(
    ...distribution.map((role) => Number(role.total_users)),
    1
  );

  container.innerHTML = distribution
    .filter((role) => role.role_code !== 'SUPER_ADMIN')
    .map((role) => {
      const percentage = Math.max(
        5,
        Math.round((Number(role.total_users) / maximum) * 100)
      );

      return `
        <div>
          <div class="mb-2 flex items-center justify-between text-sm">
            <span class="font-medium text-slate-700">
              ${roleLabels[role.role_code] || role.role_name}
            </span>
            <span class="font-bold text-slate-900">${role.total_users}</span>
          </div>

          <div class="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              class="h-full rounded-full ${roleColors[role.role_code] || 'bg-slate-500'}"
              style="width: ${percentage}%"
            ></div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderAuditLogs(logs) {
  const tbody = document.querySelector('#auditLogsBody');

  if (!logs.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-10 text-center text-sm text-slate-400">
          لا توجد نشاطات مسجلة حتى الآن.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs
    .map(
      (log) => `
        <tr>
          <td class="py-4 font-semibold text-slate-800">
            ${log.actor_name || 'النظام'}
          </td>

          <td class="py-4">
            <span class="rounded-full px-3 py-1 text-xs font-medium ${eventClass(log.event_type)}">
              ${eventLabel(log.event_type)}
            </span>
          </td>

          <td class="py-4 text-slate-500">
            ${log.entity_type}
          </td>

          <td class="py-4 text-xs text-slate-500">
            ${formatDateTime(log.created_at)}
          </td>
        </tr>
      `
    )
    .join('');
}

function setSummary(summary) {
  document.querySelector('#totalUsers').textContent = summary.totalUsers;
  document.querySelector('#activeCourses').textContent = summary.activeCourses;
  document.querySelector('#inactiveUsers').textContent = summary.inactiveUsers;
  document.querySelector('#todayActivity').textContent = summary.todayActivity;

  document.querySelector('#inactiveUsersMessage').textContent =
    summary.inactiveUsers > 0
      ? `يوجد ${summary.inactiveUsers} حسابات تحتاج مراجعة.`
      : 'لا توجد حسابات موقوفة حاليًا.';
}

async function loadDashboard() {
  const response = await fetch('/api/admin/dashboard', {
    credentials: 'include',
    cache: 'no-store',
  });

  if (response.status === 401) {
    window.location.replace('/src/login/index.html');
    return;
  }

  if (response.status === 403) {
    window.location.replace('/src/login/unauthorized.html');
    return;
  }

  if (!response.ok) {
    throw new Error('فشل تحميل بيانات لوحة التحكم.');
  }

  const data = await response.json();

  setSummary(data.summary);
  renderRoleDistribution(data.roleDistribution);
  renderAuditLogs(data.recentAuditLogs);
}

async function logout() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });

  window.location.replace('/src/login/index.html');
}

async function init() {
  const user = await protectPage(['SUPER_ADMIN']);

  if (!user) return;
 document.body.classList.remove('opacity-0'); 
 
  document.querySelector('#currentDate').textContent = formatDate();
  document.querySelector('#logoutButton').addEventListener('click', logout);

  try {
    await loadDashboard();
  } catch (error) {
    console.error(error);

    document.querySelector('#auditLogsBody').innerHTML = `
      <tr>
        <td colspan="4" class="py-10 text-center text-sm text-red-600">
          تعذر تحميل بيانات لوحة التحكم. حاول تحديث الصفحة.
        </td>
      </tr>
    `;
  }
}

init();