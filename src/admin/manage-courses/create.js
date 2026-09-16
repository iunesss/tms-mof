import { protectPage } from '../../shared/auth-guard.js';
import { api, escapeHtml } from './course-api.js';

const form = document.querySelector('#createCourseForm');
const allocationsContainer = document.querySelector('#courseAllocationsContainer');
const addAllocationButton = document.querySelector('#addAllocationButton');
const courseTypeInput = document.querySelector('#courseType');
const nominationDeadlineGroup = document.querySelector('#nominationDeadlineGroup');
const nominationDeadlineInput = document.querySelector('#nominationDeadline');
const allocationsDescription = document.querySelector('#allocationsDescription');
const courseFormsContainer = document.querySelector('#courseFormsContainer');
const addCourseFormButton = document.querySelector('#addCourseFormButton');

let departments = [];


function showMessage(message, type = 'error') {
  let messageBox = document.querySelector('#formMessage');

  if (!messageBox) {
    messageBox = document.createElement('div');
    messageBox.id = 'formMessage';
    form.prepend(messageBox);
  }

  messageBox.className =
    type === 'success'
      ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700'
      : 'rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700';

  messageBox.textContent = message;
}

function clearMessage() {
  const messageBox = document.querySelector('#formMessage');

  if (messageBox) {
    messageBox.remove();
  }
}

function getOptionalText(selector) {
  return document.querySelector(selector).value.trim() || null;
}

function getRequiredPositiveInteger(selector, label) {
  const rawValue = document.querySelector(selector).value.trim();
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} يجب أن يكون رقمًا صحيحًا أكبر من صفر.`);
  }

  return value;
}

function isMission() {
  return courseTypeInput.value === 'MISSION';
}

function updateWorkflowFields() {
  const training = courseTypeInput.value === 'TRAINING';
  const mission = courseTypeInput.value === 'MISSION';

  nominationDeadlineGroup.classList.toggle('hidden', !training);
  nominationDeadlineInput.required = training;

  allocationsDescription.textContent = training
    ? 'حدّد القسم وحد الترشيحات المسموح به. عند تفعيل الدورة، يرسل النظام الدعوات مباشرة إلى مديري الأقسام.'
    : 'اختر القسم وحد الاختيار، ثم اختر موظفي المهمة من هذا القسم فقط. لا توجد دعوات أو ترشيحات إدارية للمهمة.';

  document.querySelectorAll('.allocation-row').forEach((row) => {
    const employeeSection = row.querySelector('.mission-employees-section');
    const limitInput = row.querySelector('.nomination-limit-input');
    const label = row.querySelector('.allocation-limit-label');

    if (label) {
      label.textContent = mission ? 'حد الاختيار من القسم' : 'حد الترشيحات';
    }

    if (employeeSection) {
      employeeSection.classList.toggle('hidden', !mission);
    }

    if (mission) {
      const departmentId = row.querySelector('.department-select').value;

      if (departmentId) {
        loadDepartmentEmployees(row, departmentId);
      }
    }

    if (!mission && limitInput) {
      row.querySelectorAll('.employee-checkbox').forEach((checkbox) => {
        checkbox.checked = false;
      });
    }
  });
}

function createDepartmentOptions(selectedId = '') {
  return departments
    .map(
      (department) => `
        <option value="${department.id}" ${
          Number(selectedId) === Number(department.id) ? 'selected' : ''
        }>
          ${escapeHtml(department.sector_name || 'بدون قطاع')} — ${escapeHtml(department.name)}
        </option>
      `
    )
    .join('');
}

function updateSelectedEmployeesCount(row) {
  const selectedCount = row.querySelectorAll('.employee-checkbox:checked').length;
  const countElement = row.querySelector('.selected-employees-count');

  if (countElement) {
    countElement.textContent = `${selectedCount} موظف محدد`;
  }
}

async function loadDepartmentEmployees(row, departmentId) {
  const employeesSection = row.querySelector('.mission-employees-section');
  const employeesList = row.querySelector('.mission-employees-list');

  if (!isMission()) return;

  employeesSection.classList.remove('hidden');

  if (!departmentId) {
    employeesList.innerHTML =
      '<p class="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">اختر القسم أولًا.</p>';
    return;
  }

  employeesList.innerHTML =
    '<p class="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">جارٍ تحميل موظفي القسم...</p>';

  try {
    const data = await api(
      `/api/admin/courses/eligible-employees?departmentId=${encodeURIComponent(departmentId)}`
    );

    const employees = data.employees || [];

    if (!employees.length) {
      employeesList.innerHTML =
        '<p class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">لا يوجد موظفون نشطون في هذا القسم.</p>';
      return;
    }

    employeesList.innerHTML = employees
      .map(
        (employee) => `
          <label class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-brand-gold">
            <span>
              <span class="block text-xs font-semibold text-slate-800">
                ${escapeHtml(employee.full_name)}
              </span>
              <span class="mt-0.5 block text-[11px] text-slate-500">
                ${escapeHtml(employee.employee_number || employee.username)}
              </span>
            </span>

            <input
              type="checkbox"
              value="${employee.id}"
              class="employee-checkbox h-4 w-4 rounded border-slate-300 text-brand-gold focus:ring-brand-gold"
            />
          </label>
        `
      )
      .join('');

    employeesList.querySelectorAll('.employee-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const limit = Number(row.querySelector('.nomination-limit-input').value || 0);
        const selectedCount = row.querySelectorAll('.employee-checkbox:checked').length;

        if (limit > 0 && selectedCount > limit) {
          checkbox.checked = false;
          showMessage('لا يمكن اختيار موظفين أكثر من حد الاختيار المحدد لهذا القسم.');
        }

        updateSelectedEmployeesCount(row);
      });
    });

    updateSelectedEmployeesCount(row);
  } catch (error) {
    employeesList.innerHTML = `
      <p class="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
        ${escapeHtml(error.message || 'تعذر تحميل موظفي القسم.')}
      </p>
    `;
  }
}

function createAllocationRow() {
  const row = document.createElement('div');

  row.className =
    'allocation-row rounded-lg border border-slate-200 bg-slate-50 p-3';

  row.innerHTML = `
    <div class="grid gap-3 md:grid-cols-[1fr_180px_auto]">
      <select class="department-select rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs outline-none focus:border-brand-gold">
        <option value="">اختر القسم</option>
        ${createDepartmentOptions()}
      </select>

      <div>
        <label class="allocation-limit-label mb-1 block text-[11px] font-semibold text-slate-600">
          حد الترشيحات
        </label>

        <input
          type="number"
          min="1"
          placeholder="مثال: 5"
          class="nomination-limit-input w-full rounded-lg border border-slate-300 px-3 py-2.5 text-xs outline-none focus:border-brand-gold"
        />
      </div>

      <button
        type="button"
        class="remove-allocation rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
      >
        حذف
      </button>
    </div>

    <div class="mission-employees-section mt-4 hidden rounded-lg border border-brand-gold/30 bg-brand-lightGold/30 p-3">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <p class="text-xs font-bold text-slate-800">موظفو القسم للمهمة</p>
          <p class="mt-0.5 text-[11px] text-slate-500">اختر فقط الموظفين الذين سيشاركون في المهمة.</p>
        </div>

        <span class="selected-employees-count rounded-md bg-white px-2 py-1 text-[11px] font-bold text-brand-darkGold">
          0 موظف محدد
        </span>
      </div>

      <div class="mission-employees-list grid gap-2 md:grid-cols-2"></div>
    </div>
  `;

  row.querySelector('.remove-allocation').addEventListener('click', () => {
    row.remove();

    if (!allocationsContainer.querySelector('.allocation-row')) {
      allocationsContainer.innerHTML = `
        <p class="empty-allocations-message rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
          أضف قسمًا وحدد حد الترشيحات أو الاختيار.
        </p>
      `;
    }
  });

  row.querySelector('.department-select').addEventListener('change', async (event) => {
    if (isMission()) {
      await loadDepartmentEmployees(row, event.target.value);
    }
  });

  return row;
}

function addAllocation() {
  allocationsContainer.querySelector('.empty-allocations-message')?.remove();

  const row = createAllocationRow();
  allocationsContainer.appendChild(row);

  updateWorkflowFields();
}

async function loadDepartments() {
  const data = await api('/api/admin/courses/organization/options');
  departments = data.departments || [];

  if (!departments.length) {
    throw new Error('لا توجد أقسام نشطة يمكن استخدامها.');
  }
}

function collectAllocationsAndEmployees() {
  const rows = [...allocationsContainer.querySelectorAll('.allocation-row')];

  if (!rows.length) {
    throw new Error('يرجى إضافة قسم واحد على الأقل.');
  }

  const usedDepartmentIds = new Set();
  const allocations = [];
  const directEmployeeIds = [];

  for (const row of rows) {
    const departmentId = Number(row.querySelector('.department-select').value);
    const nominationLimit = Number(
      row.querySelector('.nomination-limit-input').value
    );

    if (!Number.isInteger(departmentId) || departmentId <= 0) {
      throw new Error('يرجى اختيار قسم في كل صف.');
    }

    if (!Number.isInteger(nominationLimit) || nominationLimit <= 0) {
      throw new Error('حد الترشيحات أو الاختيار يجب أن يكون أكبر من صفر.');
    }

    if (usedDepartmentIds.has(departmentId)) {
      throw new Error('لا يمكن إضافة القسم نفسه أكثر من مرة.');
    }

    usedDepartmentIds.add(departmentId);

    const employeeIds = [
      ...row.querySelectorAll('.employee-checkbox:checked'),
    ].map((checkbox) => Number(checkbox.value));

    if (isMission()) {
      if (!employeeIds.length) {
        throw new Error('اختر موظفًا واحدًا على الأقل من كل قسم في المهمة.');
      }

      if (employeeIds.length > nominationLimit) {
        throw new Error('عدد الموظفين المختارين أكبر من حد الاختيار المحدد للقسم.');
      }

      directEmployeeIds.push(...employeeIds);
    }

    allocations.push({
      departmentId,
      nominationLimit,
      employeeIds,
    });
  }

  const duplicateEmployee = directEmployeeIds.some(
    (employeeId, index) => directEmployeeIds.indexOf(employeeId) !== index
  );

  if (duplicateEmployee) {
    throw new Error('لا يمكن اختيار الموظف نفسه أكثر من مرة.');
  }

  return { allocations, directEmployeeIds };
}

function appendCourseFields(formData, courseData) {
  Object.entries(courseData).forEach(([key, value]) => {
    formData.append(key, value ?? '');
  });
}

courseTypeInput.addEventListener('change', updateWorkflowFields);
addAllocationButton.addEventListener('click', addAllocation);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();

  try {
    const courseType = courseTypeInput.value;

    if (!courseType) {
      throw new Error('يرجى اختيار نوع السجل.');
    }

    const totalSeats = getRequiredPositiveInteger(
      '#totalSeats',
      'إجمالي المقاعد النهائية'
    );

    const { allocations, directEmployeeIds } =
      collectAllocationsAndEmployees();

    if (
      courseType === 'MISSION' &&
      directEmployeeIds.length > totalSeats
    ) {
      throw new Error(
        'عدد الموظفين المختارين للمهمة أكبر من إجمالي المقاعد النهائية.'
      );
    }

    const rawStatus = document.querySelector('#courseStatus').value;

    /*
      التدريب النشط = OPEN_FOR_NOMINATION
      المهمة النشطة = ACTIVE
    */
    const status =
      courseType === 'TRAINING' && rawStatus === 'ACTIVE'
        ? 'OPEN_FOR_NOMINATION'
        : rawStatus;

    const courseData = {
      courseNo: getOptionalText('#courseNumber'),
      courseType,
      status,
      title: document.querySelector('#courseTitle').value.trim(),
      description: getOptionalText('#courseDescription'),
      provider: getOptionalText('#providerName'),
      location: [
        getOptionalText('#country'),
        getOptionalText('#city'),
      ]
        .filter(Boolean)
        .join(' - ') || null,
      totalSeats,
      startDate: document.querySelector('#startDate').value || null,
      endDate: document.querySelector('#endDate').value || null,
      nominationDeadline:
        courseType === 'TRAINING'
          ? nominationDeadlineInput.value || null
          : null,
    };

    if (!courseData.title) {
      throw new Error('يرجى كتابة اسم الدورة أو المهمة.');
    }

    if (!courseData.startDate || !courseData.endDate) {
      throw new Error('يرجى تحديد تاريخ البداية والنهاية.');
    }
const startDate = document.querySelector('#startDate').value;
const endDate = document.querySelector('#endDate').value;

if (new Date(endDate) < new Date(startDate)) {
  throw new Error('تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساويًا له.');
}
    const formData = new FormData();

    appendCourseFields(formData, courseData);

    formData.append('allocations', JSON.stringify(allocations));
    formData.append(
      'directEmployeeIds',
      JSON.stringify(directEmployeeIds)
    );

    [
      ['agenda', '#agendaFile'],
      ['program', '#programFile'],
      ['invitationTemplate', '#invitationTemplateFile'],
      ['attachment', '#courseAttachmentFile'],
    ].forEach(([name, selector]) => {
      const file = document.querySelector(selector).files[0];

      if (file) {
        formData.append(name, file);
      }
    });

    const { courseForms, templateFiles } = collectCourseForms();

formData.append('courseForms', JSON.stringify(courseForms));

templateFiles.forEach((file) => {
  formData.append('courseFormTemplates', file);
});


    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'جارٍ الحفظ...';

    const data = await api('/api/admin/courses', {
      method: 'POST',
      body: formData,
    });

    showMessage('تم إنشاء الدورة أو المهمة بنجاح.', 'success');

    setTimeout(() => {
      window.location.href = `./manage-course.html?id=${data.course.id}`;
    }, 700);
  } catch (error) {
    showMessage(error.message);
  } finally {
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = false;
    submitButton.textContent = 'حفظ الدورة';
  }
});

async function initialize() {
  const session = await protectPage(['SUPER_ADMIN']);
  if (!session) return;

  try {
    await loadDepartments();
    updateWorkflowFields();
  } catch (error) {
    showMessage(`تعذر تحميل الأقسام: ${error.message}`);
    addAllocationButton.disabled = true;
  }
}
function createCourseFormRow(form = {}) {
  const row = document.createElement('div');

  row.className =
    'course-form-row grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_180px_180px_auto]';

  row.innerHTML = `
    <input
      type="text"
      value="${escapeHtml(form.title || '')}"
      placeholder="اسم الاستمارة"
      class="course-form-title rounded-lg border border-slate-300 px-3 py-2.5 text-xs outline-none focus:border-brand-gold"
    />

    <input
      type="file"
      accept=".pdf,.doc,.docx"
      class="course-form-file text-xs text-slate-500"
    />

    <div class="space-y-2">
      <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input
          type="checkbox"
          class="course-form-required rounded border-slate-300 text-brand-gold"
          ${form.is_required === 0 ? '' : 'checked'}
        />
        إلزامية
      </label>

  
    </div>

    <button
      type="button"
      class="remove-course-form rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
    >
      حذف
    </button>
  `;

  row.querySelector('.remove-course-form').addEventListener('click', () => {
    row.remove();
  });

  return row;
}

function collectCourseForms() {
  const rows = [...courseFormsContainer.querySelectorAll('.course-form-row')];
  const courseForms = [];
  const templateFiles = [];

  rows.forEach((row) => {
    const title = row.querySelector('.course-form-title').value.trim();
    const file = row.querySelector('.course-form-file').files[0];
    const isRequired = row.querySelector('.course-form-required').checked;
const dueAt = null;
    if (!title && !file) {
      return;
    }

    if (!title || !file) {
      throw new Error('كل استمارة تحتاج اسمًا وملفًا.');
    }

    courseForms.push({
      title,
      isRequired,
      dueAt,
      fileIndex: templateFiles.length,
    });

    templateFiles.push(file);
  });

  return {
    courseForms,
    templateFiles,
  };
}

addCourseFormButton.addEventListener('click', () => {
  courseFormsContainer.appendChild(createCourseFormRow());
});


initialize();