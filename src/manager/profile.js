import { protectPage } from '../shared/auth-guard.js';

let profileData = null;

const modal = document.querySelector('#editProfileModal');
const profileMessage = document.querySelector('#profileMessage');
const formMessage = document.querySelector('#editProfileFormMessage');

function setText(selector, value, fallback = '—') {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value || fallback;
  }
}

function showMessage(element, message, type = 'error') {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
  };

  element.textContent = message;
  element.className =
    `rounded-xl border px-4 py-3 text-xs font-semibold ${styles[type]}`;

  element.classList.remove('hidden');
}

function hideMessage(element) {
  element.textContent = '';
  element.classList.add('hidden');
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
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
    throw new Error(data.message || 'تعذر تنفيذ الطلب.');
  }

  return data;
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

function renderDocuments(documents = []) {
  const passportPreview = document.querySelector('#passportPreview');
  const passport = documents.find(
    (document) => String(document.document_type).toUpperCase() === 'PASSPORT'
  );
  passportPreview.replaceChildren();
  if (!passport?.file_url) {
    passportPreview.textContent = 'لا يوجد جواز سفر مرفوع.';
    return;
  }
  const link = document.createElement('a');
  link.href = passport.file_url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'text-brand-darkGold underline transition hover:text-brand-gold';
  link.textContent = 'عرض جواز السفر';
  passportPreview.append(link);
}
function fillLockedFields(profile) {
  const fullNameInput = document.querySelector('#editFullName');
  const employeeNumberInput = document.querySelector(
    '#editEmployeeNumber'
  );

  if (fullNameInput) {
    fullNameInput.value = profile.full_name || '';
  }

  if (employeeNumberInput) {
    employeeNumberInput.value = profile.employee_number || '';
  }
}
function renderProfile(profile) {
  fillLockedFields(profile);
  profileData = profile;

  setText('#profileFullName', profile.full_name);
  setText('#profileJobTitle', profile.job_title);
  setText('#profileUsername', profile.username);
  setText('#profileEmployeeNumber', profile.employee_number);
  setText('#profileEmail', profile.email);
  setText('#profilePhone', profile.phone);
  setText('#profileSectorName', profile.sector_name);
  setText('#profileDepartmentName', profile.department_name);
  setText('#profileJobTitleDetails', profile.job_title);

  const statusBadge = document.querySelector('#profileAccountStatus');

  if (profile.is_active) {
    statusBadge.textContent = 'نشط';
    statusBadge.className =
      'rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700';
  } else {
    statusBadge.textContent = 'موقوف';
    statusBadge.className =
      'rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-700';
  }

  document.querySelector('#editEmail').value = profile.email || '';
  document.querySelector('#editPhone').value = profile.phone || '';
  document.querySelector('#editJobTitle').value = profile.job_title || '';
  document.querySelector('#passportFile').value = '';

  renderDocuments(profile.documents || []);
}

function openModal() {
  if (!profileData) return;
fillLockedFields(profileData);
  hideMessage(formMessage);

  document.querySelector('#editEmail').value = profileData.email || '';
  document.querySelector('#editPhone').value = profileData.phone || '';
  document.querySelector('#editJobTitle').value = profileData.job_title || '';
  document.querySelector('#passportFile').value = '';

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeModal() {
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  hideMessage(formMessage);
}

async function loadNotificationsCount() {
  try {
    const data = await request('/api/notifications?limit=1');

    if (!data) return;

    const badge = document.querySelector('#notificationsBadge');
    const unreadCount = Number(data.unreadCount || 0);

    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {
    // لا نوقف صفحة البروفايل إذا تعذر تحميل عداد الإشعارات.
  }
}

async function loadProfile() {
  const data = await request('/api/profile');

  if (!data) return;

  renderProfile(data.profile || data);
}

async function saveProfile(event) {
  event.preventDefault();

  hideMessage(formMessage);

  const email = document.querySelector('#editEmail').value.trim();
  const phone = document.querySelector('#editPhone').value.trim();
  const jobTitle = document.querySelector('#editJobTitle').value.trim();
  const passportFile = document.querySelector('#passportFile').files[0];

  const formData = new FormData();

  formData.append('email', email);
  formData.append('phone', phone);
  formData.append('jobTitle', jobTitle);

  if (passportFile) {
    formData.append('passportFile', passportFile);
  }

  const saveButton = document.querySelector('#saveProfileButton');

  try {
    saveButton.disabled = true;
    saveButton.textContent = 'جارٍ حفظ التعديلات...';

    const data = await request('/api/profile', {
      method: 'PATCH',
      body: formData,
    });

    renderProfile(data.profile || data);
    showMessage(profileMessage, 'تم حفظ بيانات الملف الشخصي بنجاح.', 'success');

    closeModal();
  } catch (error) {
    showMessage(
      formMessage,
      error.message || 'تعذر حفظ بيانات الملف الشخصي.'
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'حفظ التعديلات';
  }
}

async function initialize() {
  const session = await protectPage(['DEPARTMENT_MANAGER']);

  if (!session) return;

  setText(
    '#currentUserName',
    session.full_name || session.fullName || session.username,
    'مدير القسم'
  );

  document.querySelector('#logoutButton').addEventListener('click', logout);

  document
    .querySelector('#openEditProfileButtonSecondary')
    .addEventListener('click', openModal);

  document
    .querySelector('#closeEditProfileButton')
    .addEventListener('click', closeModal);

  document
    .querySelector('#cancelEditProfileButton')
    .addEventListener('click', closeModal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document
    .querySelector('#editProfileForm')
    .addEventListener('submit', saveProfile);

  try {
    await Promise.all([loadProfile(), loadNotificationsCount()]);
  } catch (error) {
    showMessage(
      profileMessage,
      error.message || 'تعذر تحميل بيانات الملف الشخصي.'
    );
  }
}

initialize();
