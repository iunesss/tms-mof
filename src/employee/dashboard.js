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


/** يحدد الإجراء التالي من حالة الاستمارات والمرشح؛ ولا يعد الانتظار إجراءً مطلوبًا. */
function renderCurrentAction(course, details) {
  const container = document.querySelector('#currentAction');
  if (!course) {
    container.textContent = 'لا توجد دورة حالية، ولا يلزمك إجراء الآن.';
    return;
  }

  const forms = (details.forms || []).filter((form) => Number(form.is_required));
  const rejected = forms.find((form) => form.submission_status === 'REJECTED');
  const missing = forms.find((form) => !form.submitted_file_url);
  const status = details.candidate?.status;
  let message = 'لا يلزمك إجراء الآن. انتظر تحديث حالة مشاركتك.';
  let showLink = false;

  if (rejected) {
    message = `أعد رفع الاستمارة المرفوضة: ${rejected.title}.`;
    showLink = true;
  } else if (missing) {
    message = `حمّل وعبّئ ثم ارفع الاستمارة: ${missing.title}.`;
    showLink = true;
  } else if (['CONFIRMED', 'PARTICIPATING', 'COMPLETED'].includes(status)) {
    message = 'تم تأكيد مشاركتك. لا توجد استمارات مطلوبة منك الآن.';
  } else if (forms.some((form) => form.submission_status !== 'APPROVED')) {
    message = 'استماراتك مرفوعة وتنتظر المراجعة. لا يلزمك إجراء الآن.';
  } else {
    message = 'استماراتك معتمدة. انتظر قرار تأكيد المشاركة.';
  }

  container.innerHTML = `
    <p class="font-semibold text-slate-700">${escapeHtml(message)}</p>
    ${showLink ? `<a href="./course-info.html?id=${encodeURIComponent(course.id)}"
      class="mt-4 inline-block rounded-lg bg-brand-gold px-4 py-2 font-bold text-white">
      فتح الاستمارات
    </a>` : ''}
  `;
}

/** يعرض مراحل المشاركة وفق الحالة الفعلية؛ اعتماد الاستمارات يختلف عن تأكيد المرشح. */
function renderCourseProgress(course, details) {
  const container = document.querySelector('#courseProgress');
  if (!course) {
    container.innerHTML = '<li class="text-slate-500">يظهر تقدمك بعد اختيارك لدورة.</li>';
    return;
  }

  const forms = (details.forms || []).filter((form) => Number(form.is_required));
  const hasForms = forms.length > 0;
  const confirmed = ['CONFIRMED', 'PARTICIPATING', 'COMPLETED']
    .includes(details.candidate?.status);
  const steps = [
    { title: 'تم اختيارك للدورة', done: true },
    { title: hasForms ? 'رفع الاستمارات المطلوبة' : 'لا توجد استمارات إلزامية',
      done: !hasForms || forms.every((form) => Boolean(form.submitted_file_url)) },
    { title: hasForms ? 'اعتماد الاستمارات' : 'الاستمارات غير مطلوبة',
      done: !hasForms || forms.every((form) => form.submission_status === 'APPROVED') },
    { title: 'تأكيد المشاركة', done: confirmed },
  ];

  container.innerHTML = steps.map((step) => `
    <li class="flex items-center gap-2 ${step.done ? 'font-semibold text-emerald-700' : 'text-slate-500'}">
      <span aria-hidden="true" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full
        ${step.done ? 'bg-emerald-100' : 'bg-slate-100'}">
        ${step.done ? '✓' : '○'}
      </span>
      <span>${step.title}</span>
    </li>
  `).join('');
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

  container.innerHTML = notifications.slice(0, 3)
    .map(
      (notification) => `
        <article
          class="rounded-lg border border-slate-100 bg-slate-50 p-2"
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
                class="mt-1 line-clamp-1 text-[11px] leading-5 text-slate-500"
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
  const [data, currentCoursesData, archiveData] = await Promise.all([
    api('/api/dashboard'),
    api('/api/courses'),
    api('/api/courses/archive'),
  ]);

  const summary = data.summary || {};
  const employee = data.employee || {};
  const department = employee.department || {};
  const currentCourses = currentCoursesData.courses || [];
  const currentCourse = currentCourses[0] || null;

  document.querySelector('#departmentName').textContent =
    department.name || 'لم يتم تعيين قسم';

  const jobTitle = document.querySelector('#jobTitle');
  jobTitle.textContent = employee.jobTitle || '';
  jobTitle.classList.toggle('hidden', !employee.jobTitle);

  document.querySelector('#currentCourseCount').textContent =
    currentCourses.length;

  document.querySelector('#previousCoursesCount').textContent =
    (archiveData.courses || []).length;

  // الاستمارات الإلزامية غير المعتمدة تُحسب من تفاصيل دورة الموظف الفعلية.
  const formsCount = document.querySelector('#pendingFormsCount');
  let currentDetails = null;
  if (currentCourse) {
    try {
      currentDetails = await api(`/api/courses/${currentCourse.id}`);
      formsCount.textContent = (currentDetails.forms || []).filter((form) =>
        Number(form.is_required) && form.submission_status !== 'APPROVED'
      ).length;
    } catch (error) {
      formsCount.textContent = '—';
      console.error('تعذر تحميل عدد الاستمارات:', error);
    }
  } else {
    formsCount.textContent = '0';
  }

  document.querySelector('#unreadNotificationsCount').textContent =
    summary.unreadNotifications ?? 0;

  setUnreadBadge(Number(summary.unreadNotifications || 0));

  if (currentCourse && !currentDetails) {
    document.querySelector('#currentAction').textContent =
      'تعذر تحميل الإجراءات الآن. حاول تحديث الصفحة.';
    document.querySelector('#courseProgress').innerHTML =
      '<li class="text-slate-500">تعذر تحميل تقدم الإجراءات.</li>';
  } else {
    renderCurrentAction(currentCourse, currentDetails);
    renderCourseProgress(currentCourse, currentDetails);
  }

  renderNotifications(data.recentNotifications || []);
}


async function initialize() {

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


    document.querySelector('#currentAction').textContent =
      error.message || 'تعذر تحميل لوحة التحكم.';
    document.querySelector('#courseProgress').innerHTML =
      '<li class="text-slate-500">تعذر تحميل تقدم الإجراءات.</li>';
    document.querySelector('#recentNotificationsList').textContent =
      'تعذر تحميل الإشعارات.';

  }
}


initialize();
