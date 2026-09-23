import { protectPage } from '../shared/auth-guard.js';

let profileData = null;

function setText(selector, value, fallback = '—') {
  const element = document.querySelector(selector);
  if (element) element.textContent = value || fallback;
}

function showMessage(element, message, type = 'error') {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
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

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    window.location.replace('/src/login/index.html');
    return null;
  }

  if (!response.ok) {
    throw new Error(data.message || 'تعذر تنفيذ الطلب.');
  }

  return data;
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('/src/login/index.html');
  }
}

function fillEditForm(profile) {
  document.querySelector('#editFullName').value =
    profile.full_name || '';

  document.querySelector('#editEmployeeNumber').value =
    profile.employee_number || '';

  document.querySelector('#editEmail').value = profile.email || '';
  document.querySelector('#editPhone').value = profile.phone || '';
  document.querySelector('#editJobTitle').value =
    profile.job_title || '';

  document.querySelector('#passportFile').value = '';
}

function renderDocuments(documents = []) {
  const passportPreview = document.querySelector('#passportPreview');
  const passport = documents.find(
    (document) => document.document_type === 'PASSPORT'
  );
  passportPreview.replaceChildren();
  if (!passport?.file_url) {
    passportPreview.textContent = 'لا يوجد جواز مرفوع.';
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

function renderProfile(profile) {
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

  const status = document.querySelector('#profileAccountStatus');

  if (profile.is_active) {
    status.textContent = 'نشط';
    status.className =
      'rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700';
  } else {
    status.textContent = 'موقوف';
    status.className =
      'rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-700';
  }

  fillEditForm(profile);
  renderDocuments(profile.documents || []);
}

function openModal() {
  if (!profileData) return;

  hideMessage(document.querySelector('#editProfileFormMessage'));
  fillEditForm(profileData);

  const modal = document.querySelector('#editProfileModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeModal() {
  const modal = document.querySelector('#editProfileModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function loadProfile() {
  const data = await api('/api/profile');
  if (data) renderProfile(data.profile || data);
}

async function saveProfile(event) {
  event.preventDefault();

  const button = document.querySelector('#saveProfileButton');
  const formMessage = document.querySelector('#editProfileFormMessage');

  hideMessage(formMessage);

  const formData = new FormData();
  formData.append(
    'email',
    document.querySelector('#editEmail').value.trim()
  );
  formData.append(
    'phone',
    document.querySelector('#editPhone').value.trim()
  );
  formData.append(
    'jobTitle',
    document.querySelector('#editJobTitle').value.trim()
  );

  const passportFile = document.querySelector('#passportFile').files[0];

  if (passportFile) {
    formData.append('passportFile', passportFile);
  }

  try {
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ...';

    const data = await api('/api/profile', {
      method: 'PATCH',
      body: formData,
    });

    renderProfile(data.profile || data);

    showMessage(
      document.querySelector('#profileMessage'),
      data.message || 'تم حفظ بيانات الملف الشخصي بنجاح.',
      'success'
    );

    closeModal();
  } catch (error) {
    showMessage(formMessage, error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'حفظ التعديلات';
  }
}

async function initialize() {
  const user = await protectPage(['EMPLOYEE']);
  if (!user) return;

  setText(
    '#currentUserName',
    user.fullName || user.full_name || user.username,
    'الموظف'
  );

  document.querySelector('#logoutButton').addEventListener('click', logout);

  document.querySelector('#openEditProfileButtonSecondary')
    .addEventListener('click', openModal);

  document.querySelector('#closeEditProfileButton')
    .addEventListener('click', closeModal);

  document.querySelector('#cancelEditProfileButton')
    .addEventListener('click', closeModal);

  document.querySelector('#editProfileModal').addEventListener(
    'click',
    (event) => {
      if (event.target.id === 'editProfileModal') {
        closeModal();
      }
    }
  );

  document.querySelector('#editProfileForm')
    .addEventListener('submit', saveProfile);

  try {
    await loadProfile();
  } catch (error) {
    showMessage(
      document.querySelector('#profileMessage'),
      error.message || 'تعذر تحميل الملف الشخصي.'
    );
  }
}

initialize();
