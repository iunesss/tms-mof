import { protectPage } from '/src/shared/auth-guard.js';
import { bindLiveFilters } from '/src/shared/live-filters.js';

const state = {
  page: 1,
  limit: 10,
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function roleLabel(role) {
  const roles = {
    SUPER_ADMIN: 'المسؤول الشامل',
    COURSE_MANAGER: 'مدير دورة',
    AGENT: 'وكيل قطاع',
    DEPARTMENT_MANAGER: 'مدير قسم',
    EMPLOYEE: 'موظف',
  };

  return roles[role] || 'دور غير معروف';
}

function getAssignmentText(user) {
  if (user.roles?.includes('AGENT')) {
    return user.sector_name || 'لم يتم تعيين قطاع';
  }

  if (user.roles?.includes('DEPARTMENT_MANAGER')) {
    return user.department_name || 'لم يتم تعيين قسم';
  }

  if (user.roles?.includes('EMPLOYEE')) {
    return user.department_manager_name || 'لم يتم تعيين مدير قسم';
  }

  return '—';
}

function renderUsers(users) {
  const body = document.querySelector('#usersTableBody');

  if (!users.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="px-6 py-12 text-center text-slate-400">
          لا توجد نتائج مطابقة.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = users.map((user) => `
    <tr class="hover:bg-slate-50">
      <td class="px-6 py-4">
        <p class="font-semibold text-slate-800">
          ${escapeHtml(user.full_name || 'بدون اسم')}
        </p>
      </td>

      <td class="px-6 py-4 font-mono text-xs text-slate-600">
        ${escapeHtml(user.username)}
      </td>

      <td class="px-6 py-4 text-slate-600">
        ${escapeHtml(user.employee_number || '—')}
      </td>

      <td class="px-6 py-4">
        <div class="flex flex-wrap gap-1">
          ${(user.roles || []).map((role) => `
            <span class="rounded-full bg-brand-lightGold px-2.5 py-1 text-xs font-medium text-brand-darkGold">
              ${roleLabel(role)}
            </span>
          `).join('')}
        </div>
      </td>

      <td class="px-6 py-4 text-slate-600">
        ${escapeHtml(getAssignmentText(user))}
      </td>

      <td class="px-6 py-4">
        ${
          user.is_active
            ? `
              <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                نشط
              </span>
            `
            : `
              <span class="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                موقوف
              </span>
            `
        }
      </td>

      <td class="px-6 py-4">
        <a
          href="./alter.html?id=${encodeURIComponent(user.id)}"
          class="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-brand-gold hover:bg-brand-lightGold"
        >
          تعديل
        </a>
      </td>
    </tr>
  `).join('');
}

function renderPagination(pagination) {
  const element = document.querySelector('#pagination');

  element.innerHTML = `
    <p class="text-slate-500">
      صفحة ${pagination.page} من ${pagination.totalPages || 1}
      <span class="mr-2 text-xs text-slate-400">
        (${pagination.total} مستخدم)
      </span>
    </p>

    <div class="flex gap-2">
      <button
        id="previousPageButton"
        type="button"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        ${pagination.page <= 1 ? 'disabled' : ''}
      >
        السابق
      </button>

      <button
        id="nextPageButton"
        type="button"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        ${pagination.page >= pagination.totalPages ? 'disabled' : ''}
      >
        التالي
      </button>
    </div>
  `;

  document.querySelector('#previousPageButton').addEventListener('click', () => {
    state.page -= 1;
    loadUsers();
  });

  document.querySelector('#nextPageButton').addEventListener('click', () => {
    state.page += 1;
    loadUsers();
  });
}

async function loadUsers() {
  const search = document.querySelector('#searchInput').value.trim();
  const role = document.querySelector('#roleFilter').value;
  const status = document.querySelector('#statusFilter').value;

  const query = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
  });

  if (search) query.set('search', search);
  if (role) query.set('role', role);
  if (status) query.set('status', status);

  const response = await fetch(`/api/users?${query.toString()}`, {
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
    throw new Error('تعذر تحميل المستخدمين.');
  }

  const data = await response.json();

  document.querySelector('#usersCountText').textContent =
    `إجمالي النتائج: ${data.pagination.total}`;

  renderUsers(data.users);
  renderPagination(data.pagination);
}

async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } finally {
    window.location.replace('/src/login/index.html');
  }
}

async function init() {
  const user = await protectPage(['SUPER_ADMIN']);

  if (!user) return;
  bindLiveFilters('#filtersForm', () => {
    state.page = 1;
    loadUsers();
  });

  document.querySelector('#logoutButton').addEventListener('click', logout);

  document.querySelector('#filtersForm').addEventListener('submit', (event) => {
    event.preventDefault();
    state.page = 1;
    loadUsers();
  });

  document.querySelector('#resetFiltersButton').addEventListener('click', () => {
    document.querySelector('#filtersForm').reset();
    state.page = 1;
    loadUsers();
  });

  try {
    await loadUsers();
  } catch (error) {
    console.error(error);

    document.querySelector('#usersTableBody').innerHTML = `
      <tr>
        <td colspan="7" class="px-6 py-12 text-center text-red-600">
          تعذر تحميل المستخدمين. حاول تحديث الصفحة.
        </td>
      </tr>
    `;
  }
}

init();
