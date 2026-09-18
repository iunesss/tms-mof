import { protectPage } from '../shared/auth-guard.js';


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


function courseStatusText(status) {
  const statuses = {
    DRAFT: 'مسودة',
    OPEN_FOR_NOMINATION: 'مفتوحة للترشيح',
    NOMINATION_CLOSED: 'أُغلق الترشيح',
    CANDIDATE_PROCESSING: 'قيد معالجة المرشحين',
    ACTIVE: 'نشطة',
    COMPLETED: 'مكتملة',
    ARCHIVED: 'مؤرشفة',
    CANCELLED: 'ملغاة',
  };

  return statuses[status] || status || '—';
}


function courseTypeText(type) {
  return type === 'MISSION'
    ? 'مهمة / بعثة'
    : 'دورة تدريبية';
}


function statusClass(status) {
  const classes = {
    OPEN_FOR_NOMINATION: 'bg-blue-50 text-blue-700',
    NOMINATION_CLOSED: 'bg-amber-50 text-amber-700',
    CANDIDATE_PROCESSING: 'bg-violet-50 text-violet-700',
    ACTIVE: 'bg-emerald-50 text-emerald-700',
    COMPLETED: 'bg-slate-100 text-slate-600',
    ARCHIVED: 'bg-slate-100 text-slate-600',
    CANCELLED: 'bg-rose-50 text-rose-700',
  };

  return classes[status] || 'bg-slate-100 text-slate-600';
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

  if (response.status === 403) {
    window.location.replace('/src/login/unauthorized.html');
    return null;
  }

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


function setEmployeeIdentity(user) {
  const userName =
    user?.fullName ||
    user?.full_name ||
    user?.username ||
    'الموظف';

  document.querySelector('#currentUserName').textContent =
    userName;

  document.querySelector('#welcomeUserName').textContent =
    userName;
}


function renderCourses(courses = []) {
  const body = document.querySelector(
    '#employeeCoursesTableBody'
  );

  if (!courses.length) {
    body.innerHTML = `
      <tr>
        <td
          colspan="4"
          class="px-5 py-10 text-center text-xs text-slate-400"
        >
          لا توجد دورات مرشح لها حاليًا.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = courses
    .map(
      (course) => `
        <tr class="transition hover:bg-slate-50">

          <td class="px-5 py-3">

            <p class="font-bold text-slate-800">
              ${escapeHtml(course.title)}
            </p>

            <p class="mt-1 text-[10px] text-slate-400">
              ${escapeHtml(course.course_no || '—')}
            </p>

          </td>


          <td class="px-5 py-3 text-slate-600">
            ${courseTypeText(course.course_type)}
          </td>


          <td class="px-5 py-3">

            <span
              class="rounded-lg px-2 py-1 text-[10px] font-bold ${statusClass(course.status)}"
            >
              ${courseStatusText(course.status)}
            </span>

          </td>


          <td class="px-5 py-3">

            <a
              href="./course-info.html?id=${encodeURIComponent(course.id)}"
              class="text-[11px] font-bold text-brand-darkGold hover:underline"
            >
              تفاصيل الدورة ←
            </a>

          </td>

        </tr>
      `
    )
    .join('');
}


function renderNotifications(notifications = []) {
  const container = document.querySelector(
    '#recentNotificationsList'
  );

  if (!notifications.length) {
    container.innerHTML = `
      <p class="py-6 text-center text-xs text-slate-400">
        لا توجد إشعارات حديثة.
      </p>
    `;

    return;
  }

  container.innerHTML = notifications
    .map(
      (notification) => `
        <article
          class="rounded-lg border border-slate-100 bg-slate-50 p-3"
        >

          <div class="flex items-start gap-2">

            <span
              class="mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                notification.is_read
                  ? 'bg-slate-300'
                  : 'bg-brand-gold'
              }"
            ></span>


            <div class="min-w-0">

              <p class="text-xs font-bold text-slate-800">
                ${escapeHtml(notification.title)}
              </p>

              <p
                class="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500"
              >
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


function setUnreadBadge(total) {
  const badge = document.querySelector(
    '#notificationsBadge'
  );

  if (total > 0) {
    badge.textContent =
      total > 99 ? '99+' : total;

    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}


async function loadDashboard() {
  const data = await api('/api/employee/dashboard');

  const summary = data.summary || {};
  const employee = data.employee || {};
  const department = employee.department || {};

  document.querySelector('#departmentName').textContent =
    department.name || 'لم يتم تعيين قسم';

  document.querySelector('#jobTitle').textContent =
    employee.jobTitle || '—';

  /*
    الباك إند الحالي يعيد دورة حالية واحدة فقط.
    لذلك العدد يكون 1 عند وجود دورة، و0 عند عدم وجودها.
  */
  document.querySelector('#nominatedCoursesCount').textContent =
    summary.hasCurrentCourse ? 1 : 0;

  document.querySelector('#activeCoursesCount').textContent =
    summary.hasCurrentCourse ? 1 : 0;

  /*
    الباك إند الحالي لا يعيد عدد الاستمارات المطلوبة بعد.
  */
  document.querySelector('#pendingFormsCount').textContent = '0';

  document.querySelector('#unreadNotificationsCount').textContent =
    summary.unreadNotifications ?? 0;

  setUnreadBadge(Number(summary.unreadNotifications || 0));

  /*
    الباك إند يعيد currentCourse وليس recentCourses.
  */
  renderCourses(
    data.currentCourse ? [data.currentCourse] : []
  );

  renderNotifications(data.recentNotifications || []);
}


async function initialize() {

  /*
    لاحقًا سنتأكد من اسم الـROLE الحقيقي للموظف
    من نظام الصلاحيات عندك.

    لا نريد افتراضه قبل مراجعة الـBackend.
  */

  const user = await protectPage([
    'EMPLOYEE',
  ]);

  if (!user) return;


  setEmployeeIdentity(user);


  document
    .querySelector('#logoutButton')
    .addEventListener(
      'click',
      logout
    );


  try {

    await loadDashboard();

  } catch (error) {

    console.error(
      'Employee dashboard error:',
      error
    );


    document.querySelector(
      '#employeeCoursesTableBody'
    ).innerHTML = `
      <tr>

        <td
          colspan="4"
          class="px-5 py-10 text-center text-xs text-rose-600"
        >
          ${escapeHtml(error.message)}
        </td>

      </tr>
    `;

  }
}


initialize();