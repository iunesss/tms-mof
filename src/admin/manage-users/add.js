import { protectPage } from '/src/shared/auth-guard.js';

let organizationOptions = {
  agents: [],
  managers: [],
};

function showMessage(message, type = 'error') {
  const element = document.querySelector('#formMessage');

  element.textContent = message;

  element.className = type === 'success'
    ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700'
    : 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';
}

function setOptions(elementId, options, placeholder, label) {
  const select = document.querySelector(`#${elementId}`);

  select.innerHTML = `
    <option value="">${placeholder}</option>
    ${options.map((item) => `
      <option value="${item.id}">
        ${label(item)}
      </option>
    `).join('')}
  `;
}

function renderOrganizationOptions() {
  setOptions(
    'agentUserId',
    organizationOptions.agents,
    'اختر وكيل القطاع',
    (agent) => `${agent.full_name} — ${agent.sector_name}`
  );

  setOptions(
    'managerUserId',
    organizationOptions.managers,
    'اختر مدير القسم',
    (manager) => `${manager.full_name} — ${manager.department_name}`
  );
}

function updateAssignmentFields() {
  const role = document.querySelector('#roleCode').value;

  document.querySelector('#agentAssignmentSection').classList.toggle(
    'hidden',
    role !== 'AGENT'
  );

  document.querySelector('#managerAssignmentSection').classList.toggle(
    'hidden',
    role !== 'DEPARTMENT_MANAGER'
  );

  document.querySelector('#employeeAssignmentSection').classList.toggle(
    'hidden',
    role !== 'EMPLOYEE'
  );
}

async function loadOrganizationOptions() {
  try {
    const response = await fetch('/api/admin/users/organization/options', {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('تعذر تحميل الوكلاء ومديري الأقسام.');
    }

    organizationOptions = await response.json();
    renderOrganizationOptions();
  } catch (error) {
    console.error(error);

    document.querySelector('#agentUserId').innerHTML =
      '<option value="">تعذر تحميل الوكلاء</option>';

    document.querySelector('#managerUserId').innerHTML =
      '<option value="">تعذر تحميل مديري الأقسام</option>';
  }
}

function getAssignment(roleCode) {
  if (roleCode === 'AGENT') {
    return {
      sectorName: document.querySelector('#sectorName').value.trim() || null,
    };
  }

  if (roleCode === 'DEPARTMENT_MANAGER') {
    return {
      agentUserId: document.querySelector('#agentUserId').value || null,
      departmentName:
        document.querySelector('#departmentName').value.trim() || null,
    };
  }

  if (roleCode === 'EMPLOYEE') {
    return {
      managerUserId: document.querySelector('#managerUserId').value || null,
    };
  }

  return null;
}

function validateAssignment(roleCode, assignment) {
  if (roleCode === 'AGENT' && !assignment?.sectorName) {
    return 'يجب إدخال اسم القطاع للوكيل.';
  }

  if (
    roleCode === 'DEPARTMENT_MANAGER' &&
    (!assignment?.agentUserId || !assignment?.departmentName)
  ) {
    return 'يجب اختيار الوكيل وإدخال اسم القسم.';
  }

  if (roleCode === 'EMPLOYEE' && !assignment?.managerUserId) {
    return 'يجب اختيار مدير القسم للموظف.';
  }

  return null;
}

async function createUser(event) {
  event.preventDefault();

  const username = document.querySelector('#username').value.trim();
  const password = document.querySelector('#password').value;
  const confirmPassword = document.querySelector('#confirmPassword').value;
  const roleCode = document.querySelector('#roleCode').value;
  const fullName = document.querySelector('#fullName').value.trim();
  const employeeNumber =
    document.querySelector('#employeeNumber').value.trim() || null;

  const assignment = getAssignment(roleCode);

  if (!username || !password || !roleCode || !fullName) {
    showMessage('يرجى تعبئة جميع الحقول الإلزامية.');
    return;
  }

  if (password.length < 8) {
    showMessage('كلمة المرور يجب أن تحتوي 8 أحرف على الأقل.');
    return;
  }

  if (password !== confirmPassword) {
    showMessage('كلمتا المرور غير متطابقتين.');
    return;
  }

  const assignmentError = validateAssignment(roleCode, assignment);

  if (assignmentError) {
    showMessage(assignmentError);
    return;
  }

  const button = document.querySelector('#submitButton');

  try {
    button.disabled = true;
    button.textContent = 'جارٍ إنشاء المستخدم...';

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
        roleCode,
        fullName,
        employeeNumber,
        assignment,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'تعذر إنشاء المستخدم.');
    }

    showMessage('تم إنشاء المستخدم وتعيينه بنجاح.', 'success');

    window.setTimeout(() => {
      window.location.replace('./manage-users.html');
    }, 700);
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'إنشاء المستخدم';
  }
}

async function init() {
  const user = await protectPage(['SUPER_ADMIN']);

  if (!user) return;

  document.querySelector('#roleCode').addEventListener(
    'change',
    updateAssignmentFields
  );

  document.querySelector('#addUserForm').addEventListener(
    'submit',
    createUser
  );

  updateAssignmentFields();
  await loadOrganizationOptions();
}

init();