import { protectPage } from '../../shared/auth-guard.js';

const userId = new URLSearchParams(window.location.search).get('id');

let organizationOptions = {
  agents: [],
  managers: [],
};

let persistedIsActive = true;
let pendingStatusChange = null;

const form = document.querySelector('#editUserForm');
const messageBox = document.querySelector('#formMessage');
const saveButton = document.querySelector('#saveButton');

const roleCodeInput = document.querySelector('#roleCode');
const usernameInput = document.querySelector('#username');
const fullNameInput = document.querySelector('#fullName');
const employeeNumberInput = document.querySelector('#employeeNumber');
const newPasswordInput = document.querySelector('#newPassword');
const confirmNewPasswordInput = document.querySelector('#confirmNewPassword');

const assignmentSection = document.querySelector('#assignmentSection');
const assignmentTitle = document.querySelector('#assignmentTitle');
const assignmentDescription = document.querySelector('#assignmentDescription');

const agentFields = document.querySelector('#agentFields');
const managerFields = document.querySelector('#managerFields');
const employeeFields = document.querySelector('#employeeFields');
const statusModalError = document.querySelector('#statusModalError');
const sectorNameInput = document.querySelector('#sectorName');
const agentUserIdInput = document.querySelector('#agentUserId');
const departmentNameInput = document.querySelector('#departmentName');
const managerUserIdInput = document.querySelector('#managerUserId');

const accountStatusBadge = document.querySelector('#accountStatusBadge');
const statusHelpText = document.querySelector('#statusHelpText');
const statusActionButton = document.querySelector('#statusActionButton');
const pendingStatusText = document.querySelector('#pendingStatusText');

const statusModal = document.querySelector('#statusModal');
const statusModalTitle = document.querySelector('#statusModalTitle');
const statusModalDescription = document.querySelector('#statusModalDescription');
const reasonGroup = document.querySelector('#reasonGroup');
const statusReasonInput = document.querySelector('#statusReason');
const closeStatusModalButton = document.querySelector('#closeStatusModal');
const confirmStatusModalButton = document.querySelector('#confirmStatusModal');

function showMessage(message, type = 'error') {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
  };

  messageBox.textContent = message;
  messageBox.className = `rounded-2xl border px-5 py-4 text-sm font-medium ${styles[type] || styles.error}`;
  messageBox.classList.remove('hidden');

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
}
function showStatusModalError(message) {
  statusModalError.textContent = message;
  statusModalError.classList.remove('hidden');
}

function hideStatusModalError() {
  statusModalError.textContent = '';
  statusModalError.classList.add('hidden');
}
function hideMessage() {
  messageBox.classList.add('hidden');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getRoleCode(user) {
  if (user.role_code) return user.role_code;

  if (Array.isArray(user.roles) && user.roles.length > 0) {
    const firstRole = user.roles[0];
    return typeof firstRole === 'string'
      ? firstRole
      : firstRole.code;
  }

  return user.roleCode || '';
}

function getAssignment(user) {
  return user.assignment || user.currentAssignment || {
    sectorName: user.sector_name || '',
    agentUserId: user.agent_user_id || '',
    departmentName: user.department_name || '',
    managerUserId: user.manager_user_id || '',
  };
}

function populateAgentOptions(selectedAgentId = null) {
  agentUserIdInput.innerHTML = `
    <option value="">اختر وكيل القطاع</option>
    ${organizationOptions.agents.map((agent) => `
      <option
        value="${agent.id}"
        ${Number(agent.id) === Number(selectedAgentId) ? 'selected' : ''}
      >
        ${escapeHtml(agent.full_name)} — ${escapeHtml(agent.sector_name)}
      </option>
    `).join('')}
  `;
}

function populateManagerOptions(selectedManagerId = null) {
  managerUserIdInput.innerHTML = `
    <option value="">اختر مدير القسم</option>
    ${organizationOptions.managers.map((manager) => `
      <option
        value="${manager.id}"
        ${Number(manager.id) === Number(selectedManagerId) ? 'selected' : ''}
      >
        ${escapeHtml(manager.full_name)} — ${escapeHtml(manager.department_name)} — ${escapeHtml(manager.sector_name)}
      </option>
    `).join('')}
  `;
}

function clearAssignmentInputs() {
  sectorNameInput.value = '';
  departmentNameInput.value = '';
  agentUserIdInput.value = '';
  managerUserIdInput.value = '';
}

function renderAssignmentFields(roleCode, assignment = {}) {
  agentFields.classList.add('hidden');
  managerFields.classList.add('hidden');
  employeeFields.classList.add('hidden');
  assignmentSection.classList.add('hidden');



  assignmentSection.classList.remove('hidden');

  if (roleCode === 'AGENT') {
    assignmentTitle.textContent = 'تعيين وكيل القطاع';
    assignmentDescription.textContent = 'اكتب اسم القطاع الذي يتبعه هذا الوكيل.';
    agentFields.classList.remove('hidden');
    sectorNameInput.value = assignment.sectorName || assignment.sector_name || '';
    return;
  }

  if (roleCode === 'DEPARTMENT_MANAGER') {
    assignmentTitle.textContent = 'تعيين مدير القسم';
    assignmentDescription.textContent = 'اربط المدير بوكيل القطاع، ثم أدخل اسم القسم.';
    managerFields.classList.remove('hidden');

    const selectedAgentId =
      assignment.agentUserId ||
      assignment.agent_user_id ||
      '';

    populateAgentOptions(selectedAgentId);

    departmentNameInput.value =
      assignment.departmentName ||
      assignment.department_name ||
      '';

    return;
  }

  if (roleCode === 'EMPLOYEE') {
    assignmentTitle.textContent = 'تعيين الموظف';
    assignmentDescription.textContent = 'اختر مدير القسم المباشر للموظف.';
    employeeFields.classList.remove('hidden');

    const selectedManagerId =
      assignment.managerUserId ||
      assignment.manager_user_id ||
      '';

    populateManagerOptions(selectedManagerId);
  }
}

function updateStatusVisual(isActive) {
  if (isActive) {
    accountStatusBadge.textContent = 'الحساب نشط';
    accountStatusBadge.className =
      'inline-flex w-fit rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700';

    statusHelpText.textContent = 'الحساب نشط ويمكن للمستخدم تسجيل الدخول.';
    statusActionButton.textContent = 'إيقاف الحساب';
    statusActionButton.className =
      'rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-rose-700';

    return;
  }

  accountStatusBadge.textContent = 'الحساب موقوف';
  accountStatusBadge.className =
    'inline-flex w-fit rounded-full bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700';

  statusHelpText.textContent = 'الحساب موقوف ولا يستطيع المستخدم تسجيل الدخول.';
  statusActionButton.textContent = 'تنشيط الحساب';
  statusActionButton.className =
    'rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-700';
}

function updatePendingStatusMessage() {
  if (!pendingStatusChange) {
    pendingStatusText.classList.add('hidden');
    return;
  }

  pendingStatusText.classList.remove('hidden');

  pendingStatusText.textContent = pendingStatusChange.isActive
    ? 'تم تجهيز تنشيط الحساب. لن يتم الحفظ إلا عند الضغط على «حفظ التعديلات».'
    : 'تم تجهيز إيقاف الحساب. لن يتم الحفظ إلا عند الضغط على «حفظ التعديلات».';
}

function openStatusModal() {
  hideStatusModalError();
  const intendedStatus = !persistedIsActive;

  statusReasonInput.value = '';

  if (intendedStatus) {
    statusModalTitle.textContent = 'تنشيط الحساب';
    statusModalDescription.textContent =
      'سيصبح المستخدم قادرًا على تسجيل الدخول بعد حفظ التعديلات.';
    reasonGroup.classList.add('hidden');
    confirmStatusModalButton.textContent = 'تجهيز التنشيط';
    confirmStatusModalButton.className =
      'flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700';
  } else {
    statusModalTitle.textContent = 'إيقاف الحساب';
    statusModalDescription.textContent =
      'اكتب سبب الإيقاف. لن يتوقف الحساب الآن؛ سيُحفظ القرار فقط عند الضغط على حفظ التعديلات.';
    reasonGroup.classList.remove('hidden');
    confirmStatusModalButton.textContent = 'تجهيز الإيقاف';
    confirmStatusModalButton.className =
      'flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700';
  }

  statusModal.classList.remove('hidden');
  statusModal.classList.add('flex');
}

function closeStatusModal() {
  statusModal.classList.add('hidden');
  statusModal.classList.remove('flex');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `تعذر تنفيذ الطلب. رمز الخطأ: ${response.status}`);
  }

  return data;
}

async function loadOrganizationOptions() {
  try {
const data = await fetchJson(
  '/api/users/organization/options'
);
    organizationOptions = {
      agents: Array.isArray(data.agents) ? data.agents : [],
      managers: Array.isArray(data.managers) ? data.managers : [],
    };
  } catch (error) {
    organizationOptions = {
      agents: [],
      managers: [],
    };

    showMessage(
      `تعذر تحميل خيارات التعيين الإداري: ${error.message}`,
      'error'
    );
  }
}

async function loadUser() {
const data = await fetchJson(
  `/api/users/${userId}`
);  return data.user || data;
}

function fillUserForm(user) {

  const roleCode = getRoleCode(user);
  const assignment = getAssignment(user);

  usernameInput.value = user.username || '';
  fullNameInput.value = user.full_name || user.fullName || user.profile?.full_name || '';
  employeeNumberInput.value =
    user.employee_number ||
    user.employeeNumber ||
    user.profile?.employee_number ||
    '';

  roleCodeInput.value = roleCode;

  persistedIsActive = Boolean(
    user.is_active ?? user.isActive ?? true
  );

  document.querySelector('#pageTitle').textContent =
    `تعديل المستخدم: ${fullNameInput.value || user.username}`;

  renderAssignmentFields(roleCode, assignment);
  updateStatusVisual(persistedIsActive);
  updatePendingStatusMessage();
}

function buildAssignment(roleCode) {
  if (roleCode === 'AGENT') {
    return {
      sectorName: sectorNameInput.value.trim() || null,
    };
  }

  if (roleCode === 'DEPARTMENT_MANAGER') {
    return {
      agentUserId: agentUserIdInput.value
        ? Number(agentUserIdInput.value)
        : null,
      departmentName: departmentNameInput.value.trim() || null,
    };
  }

  if (roleCode === 'EMPLOYEE') {
    return {
      managerUserId: managerUserIdInput.value
        ? Number(managerUserIdInput.value)
        : null,
    };
  }

  return {};
}

roleCodeInput.addEventListener('change', () => {
  hideMessage();
  clearAssignmentInputs();
  renderAssignmentFields(roleCodeInput.value);
});

statusActionButton.addEventListener('click', openStatusModal);

closeStatusModalButton.addEventListener('click', closeStatusModal);

statusModal.addEventListener('click', (event) => {
  if (event.target === statusModal) {
    closeStatusModal();
  }
});

confirmStatusModalButton.addEventListener('click', () => {
  const intendedStatus = !persistedIsActive;
  const reason = statusReasonInput.value.trim();

  if (!intendedStatus && !reason) {
  showStatusModalError('يجب كتابة سبب إيقاف الحساب قبل المتابعة.');
  return;
}

  pendingStatusChange = {
    isActive: intendedStatus,
    reason: reason || null,
  };

  updateStatusVisual(intendedStatus);
  updatePendingStatusMessage();
  closeStatusModal();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage();

  const newPassword = newPasswordInput.value;
  const confirmNewPassword = confirmNewPasswordInput.value;

  if (newPassword && newPassword.length < 8) {
    showMessage('كلمة المرور الجديدة يجب أن تحتوي على 8 أحرف على الأقل.', 'error');
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showMessage('كلمتا المرور الجديدتان غير متطابقتين.', 'error');
    return;
  }

  const payload = {
    username: usernameInput.value.trim(),
    fullName: fullNameInput.value.trim(),
    employeeNumber: employeeNumberInput.value.trim() || null,
    roleCode: roleCodeInput.value,
    assignment: buildAssignment(roleCodeInput.value),
  };

  if (newPassword) {
    payload.newPassword = newPassword;
  }

  saveButton.disabled = true;
  saveButton.textContent = 'جارِ حفظ التعديلات...';

  try {
await fetchJson(`/api/users/${userId}`, {
          method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (pendingStatusChange) {
await fetchJson(`/api/users/${userId}/status`, {
            method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pendingStatusChange),
      });

      persistedIsActive = pendingStatusChange.isActive;
      pendingStatusChange = null;
    }

    showMessage('تم حفظ بيانات المستخدم وحالته بنجاح.', 'success');

    setTimeout(() => {
      window.location.href = './manage-users.html';
    }, 900);
  } catch (error) {
    showMessage(error.message || 'تعذر حفظ التعديلات.', 'error');

    // يعيد الشكل للحالة الفعلية إذا فشل الحفظ
    updateStatusVisual(persistedIsActive);
    updatePendingStatusMessage();
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'حفظ التعديلات';
  }
});

async function initializePage() {
  if (!userId || !/^\d+$/.test(userId)) {
    showMessage('معرّف المستخدم غير صحيح.', 'error');
    return;
  }

const sessionUser = await protectPage(['COURSE_MANAGER']);
  if (!sessionUser) {
    return;
  }

  try {
    await loadOrganizationOptions();
    const user = await loadUser();
    fillUserForm(user);
  } catch (error) {
    showMessage(error.message || 'تعذر تحميل بيانات المستخدم.', 'error');
  }
}

initializePage();
