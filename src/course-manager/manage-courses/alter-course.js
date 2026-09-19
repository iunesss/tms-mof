import { protectPage } from '../../shared/auth-guard.js';
import { configureCourseLifecycle } from '../../shared/course-lifecycle.js';
import { api, getQuery, escapeHtml } from './course-api.js';

const courseId = getQuery('id');
const form = document.querySelector('#alterCourseForm');
const container = document.querySelector('#courseAllocationsContainer');
const addButton = document.querySelector('#addAllocationButton');
const courseTypeInput = document.querySelector('#courseType');
const nominationDeadlineGroup = document.querySelector('#nominationDeadlineGroup');
const nominationDeadlineInput = document.querySelector('#nominationDeadline');
const allocationsDescription = document.querySelector('#allocationsDescription');
const courseFormsContainer = document.querySelector('#courseFormsContainer');
const addCourseFormButton = document.querySelector('#addCourseFormButton');

let removedCourseFormIds = [];
let departments = [];
let currentCourse = null;

function showMessage(message, type = 'error') {
  let box = document.querySelector('#formMessage');

  if (!box) {
    box = document.createElement('div');
    box.id = 'formMessage';
    form.prepend(box);
  }

  box.className =
    type === 'success'
      ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700'
      : 'rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700';

  box.textContent = message;
}

function clearMessage() {
  document.querySelector('#formMessage')?.remove();
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
    ? 'حد الترشيحات هو العدد المسموح به من كل قسم. عند التفعيل، تصل الدعوة مباشرة إلى مدير القسم.'
    : 'يمكنك إضافة موظفين جدد للمهمة من الأقسام المحددة. الموظفون الحاليون يظهرون في صفحة المرشحين.';

  document.querySelectorAll('.allocation-row').forEach((row) => {
    const employeeSection = row.querySelector('.mission-employees-section');
    const label = row.querySelector('.allocation-limit-label');

    if (label) {
      label.textContent = mission ? 'حد الاختيار من القسم' : 'حد الترشيحات';
    }

    employeeSection.classList.toggle('hidden', !mission);
  });
}

function createDepartmentOptions(selectedId = '') {
  return departments
    .map(
      (department) => `
        <option value="${department.id}" ${
          Number(department.id) === Number(selectedId) ? 'selected' : ''
        }>
          ${escapeHtml(department.sector_name || 'بدون قطاع')} — ${escapeHtml(department.name)}
        </option>
      `
    )
    .join('');
}

function updateSelectedCount(row) {
  const count = row.querySelectorAll('.employee-checkbox:checked').length;
  row.querySelector('.selected-employees-count').textContent =
    `${count} موظف جديد`;
}

async function loadDepartmentEmployees(row, departmentId) {
  const employeeSection = row.querySelector('.mission-employees-section');
  const employeesList = row.querySelector('.mission-employees-list');

  if (!isMission()) return;

  employeeSection.classList.remove('hidden');

  if (!departmentId) {
    employeesList.innerHTML =
      '<p class="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">اختر القسم أولًا.</p>';
    return;
  }

  employeesList.innerHTML =
    '<p class="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">جارٍ تحميل موظفي القسم...</p>';

  try {
    const data = await api(
      `/api/courses/eligible-employees?departmentId=${encodeURIComponent(departmentId)}`
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
        const count = row.querySelectorAll('.employee-checkbox:checked').length;

        if (limit > 0 && count > limit) {
          checkbox.checked = false;
          showMessage('لا يمكن تجاوز حد الاختيار المحدد لهذا القسم.');
        }

        updateSelectedCount(row);
      });
    });

    updateSelectedCount(row);
  } catch (error) {
    employeesList.innerHTML = `
      <p class="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
        ${escapeHtml(error.message || 'تعذر تحميل موظفي القسم.')}
      </p>
    `;
  }
}

function allocationRow(allocation = {}) {
  const nominationLimit =
    allocation.nomination_limit ??
    allocation.nominationLimit ??
    allocation.allocated_seats ??
    allocation.seats_allocated ??
    '';

  const row = document.createElement('div');

  row.className =
    'allocation-row rounded-lg border border-slate-200 bg-slate-50 p-3';

  row.innerHTML = `
    <div class="grid gap-3 md:grid-cols-[1fr_180px_auto]">
      <select class="department-select rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs outline-none focus:border-brand-gold">
        <option value="">اختر القسم</option>
        ${createDepartmentOptions(allocation.department_id)}
      </select>

      <div>
        <label class="allocation-limit-label mb-1 block text-[11px] font-semibold text-slate-600">
          حد الترشيحات
        </label>

        <input
          type="number"
          min="1"
          value="${nominationLimit}"
          class="nomination-limit-input w-full rounded-lg border border-slate-300 px-3 py-2.5 text-xs outline-none focus:border-brand-gold"
        />
      </div>

      <button type="button" class="remove-row rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">
        حذف
      </button>
    </div>

    <div class="mission-employees-section mt-4 hidden rounded-lg border border-brand-gold/30 bg-brand-lightGold/30 p-3">
      <div class="mb-3 flex items-center justify-between">
        <div>
          <p class="text-xs font-bold text-slate-800">إضافة موظفين جدد للمهمة</p>
          <p class="mt-0.5 text-[11px] text-slate-500">الموظفون الحاليون لا تحتاج لإعادة اختيارهم.</p>
        </div>

        <span class="selected-employees-count rounded-md bg-white px-2 py-1 text-[11px] font-bold text-brand-darkGold">
          0 موظف جديد
        </span>
      </div>

      <div class="mission-employees-list grid gap-2 md:grid-cols-2"></div>
    </div>
  `;

  row.querySelector('.remove-row').addEventListener('click', () => {
    row.remove();
  });

  row.querySelector('.department-select').addEventListener('change', async (event) => {
    if (isMission()) {
      await loadDepartmentEmployees(row, event.target.value);
    }
  });

  if (isMission() && allocation.department_id) {
    loadDepartmentEmployees(row, allocation.department_id);
  }

  return row;
}

function collectAllocationsAndNewEmployees() {
  const rows = [...container.querySelectorAll('.allocation-row')];

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

    if (employeeIds.length > nominationLimit) {
      throw new Error('عدد الموظفين الجدد أكبر من حد الاختيار للقسم.');
    }

    allocations.push({
      departmentId,
      nominationLimit,
      employeeIds,
    });

    if (isMission()) {
      directEmployeeIds.push(...employeeIds);
    }
  }

  return { allocations, directEmployeeIds };
}

function appendCourseFields(formData, courseData) {
  Object.entries(courseData).forEach(([key, value]) => {
    formData.append(key, value ?? '');
  });
}
function attachmentTypeText(type) {
  const labels = {
    AGENDA: 'الأجندة',
    PROGRAM: 'برنامج الدورة',
    GENERAL_INVITATION: 'نموذج دعوة',
    COURSE_GUIDE: 'دليل الدورة',
    OFFICIAL_DOCUMENT: 'وثيقة رسمية',
    OTHER: 'مرفق إضافي',
  };

  return labels[type] || 'مرفق';
}

function renderExistingAttachments(attachments = []) {
  const element = document.querySelector('#existingAttachmentsList');

  if (!attachments.length) {
    element.innerHTML = `
      <p class="text-xs text-slate-500">
        لا توجد مرفقات محفوظة لهذه الدورة حتى الآن.
      </p>
    `;
    return;
  }

  element.innerHTML = `
    <div class="space-y-2">
      ${attachments
        .map(
          (attachment) => `
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div>
                <p class="text-xs font-bold text-slate-800">
                  ${escapeHtml(attachmentTypeText(attachment.attachment_type))}
                </p>
                <p class="mt-0.5 text-[11px] text-slate-500">
                  ${escapeHtml(attachment.original_name)}
                </p>
              </div>

              <a
                href="${escapeHtml(attachment.file_url)}"
                target="_blank"
                rel="noopener"
                class="rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold transition hover:bg-brand-lightGold"
              >
                فتح الملف
              </a>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}
function createCourseFormRow(courseForm = {}) {
  const isExisting = Boolean(courseForm.id);

  const row = document.createElement('div');

  row.className =
    'course-form-row rounded-lg border border-slate-200 bg-slate-50 p-3';

  if (isExisting) {
    row.dataset.formId = courseForm.id;
  }

  row.innerHTML = `
    <div class="grid gap-3 md:grid-cols-[1fr_220px_180px_auto]">
      <input
        type="text"
        value="${escapeHtml(courseForm.title || '')}"
        placeholder="اسم الاستمارة"
        class="course-form-title rounded-lg border border-slate-300 px-3 py-2.5 text-xs outline-none focus:border-brand-gold"
      />

      <div>
        ${
          isExisting && courseForm.file_url
            ? `
              <a
                href="${escapeHtml(courseForm.file_url)}"
                target="_blank"
                rel="noopener"
                class="mb-2 block text-[11px] font-bold text-brand-darkGold hover:underline"
              >
                الملف الحالي: ${escapeHtml(courseForm.original_name || 'فتح الاستمارة')}
              </a>
            `
            : ''
        }

        <input
          type="file"
          accept=".pdf,.doc,.docx"
          class="course-form-file block w-full text-xs text-slate-500"
        />
      </div>

      <div class="space-y-2">
        <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            class="course-form-required rounded border-slate-300 text-brand-gold"
            ${courseForm.is_required === 0 ? '' : 'checked'}
          />
          استمارة إلزامية
        </label>

        
      </div>

      <button
        type="button"
        class="remove-course-form rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-50"
      >
        حذف
      </button>
    </div>
  `;

  row.querySelector('.remove-course-form').addEventListener('click', () => {
    const existingFormId = Number(row.dataset.formId);

    if (Number.isInteger(existingFormId) && existingFormId > 0) {
      removedCourseFormIds.push(existingFormId);
    }

    row.remove();

    if (!courseFormsContainer.querySelector('.course-form-row')) {
      courseFormsContainer.innerHTML = `
        <p class="empty-course-forms rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
          لا توجد استمارات مطلوبة حاليًا.
        </p>
      `;
    }
  });

  return row;
}

function renderExistingCourseForms(courseForms = []) {
  courseFormsContainer.innerHTML = '';

  if (!courseForms.length) {
    courseFormsContainer.innerHTML = `
      <p class="empty-course-forms rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
        لا توجد استمارات مطلوبة حاليًا.
      </p>
    `;

    return;
  }

  courseForms.forEach((courseForm) => {
    courseFormsContainer.appendChild(createCourseFormRow(courseForm));
  });
}

function addCourseFormRow() {
  courseFormsContainer.querySelector('.empty-course-forms')?.remove();

  courseFormsContainer.appendChild(createCourseFormRow());
}

function collectCourseForms() {
  const rows = [
    ...courseFormsContainer.querySelectorAll('.course-form-row'),
  ];

  const courseForms = [];
  const templateFiles = [];

  for (const row of rows) {
    const existingFormId = Number(row.dataset.formId);
    const title = row.querySelector('.course-form-title').value.trim();
    const file = row.querySelector('.course-form-file').files[0];
    const isRequired = row.querySelector('.course-form-required').checked;
const dueAt = null;
    /*
      استمارة موجودة سابقًا:
      نرسل بياناتها لتعديل العنوان والإلزامية والموعد فقط.
    */
    if (Number.isInteger(existingFormId) && existingFormId > 0) {
      if (!title) {
        throw new Error('اسم الاستمارة الحالية مطلوب.');
      }

      courseForms.push({
        id: existingFormId,
        title,
        isRequired,
        dueAt,
        fileIndex: null,
      });

      continue;
    }

    /*
      استمارة جديدة:
      يجب أن تحتوي على اسم وملف Template.
    */
    if (!title && !file) {
      continue;
    }

    if (!title || !file) {
      throw new Error('كل استمارة جديدة تحتاج اسمًا وملفًا.');
    }

    courseForms.push({
      id: null,
      title,
      isRequired,
      dueAt,
      fileIndex: templateFiles.length,
    });

    templateFiles.push(file);
  }

  return {
    courseForms,
    templateFiles,
  };
}
async function initialize() {
  const session = await protectPage(['COURSE_MANAGER']);
  if (!session) return;

  if (!courseId) {
    window.location.replace('./main-courses.html');
    return;
  }

  try {
    const [courseData, optionsData] = await Promise.all([
      api(`/api/courses/${courseId}`),
      api('/api/courses/organization/options'),
    ]);

    currentCourse = courseData.course || courseData;
    renderExistingAttachments(currentCourse.attachments || []);
    renderExistingCourseForms(currentCourse.forms || []);
    departments = optionsData.departments || [];

    document.querySelector('#pageTitle').textContent =
      `تعديل: ${currentCourse.title}`;

    document.querySelector('#courseType').value = currentCourse.course_type;
    document.querySelector('#courseNumber').value = currentCourse.course_no || '';
    document.querySelector('#courseStatus').value = currentCourse.status || 'DRAFT';
    document.querySelector('#courseTitle').value = currentCourse.title || '';
    document.querySelector('#courseDescription').value =
      currentCourse.description || '';

    document.querySelector('#providerName').value =
      currentCourse.provider || currentCourse.provider_name || '';

    /*
      قاعدة البيانات تحفظ المكان في حقل واحد.
      نظهره في الدولة إلى أن يتم فصل الدولة والمدينة مستقبلًا.
    */
   const locationParts = String(
  currentCourse.location || ''
)
  .split(' - ')
  .map((part) => part.trim())
  .filter(Boolean);

document.querySelector('#country').value =
  locationParts[0] || currentCourse.country || '';

document.querySelector('#city').value =
  locationParts.slice(1).join(' - ') ||
  currentCourse.city ||
  '';

    document.querySelector('#totalSeats').value =
      currentCourse.total_seats || '';

    document.querySelector('#startDate').value =
      String(currentCourse.start_date || '').slice(0, 10);

    document.querySelector('#endDate').value =
      String(currentCourse.end_date || '').slice(0, 10);

    nominationDeadlineInput.value =
      String(currentCourse.nomination_deadline || '').slice(0, 10);

    document.querySelector('#backToCourseLink').href =
      `./manage-course.html?id=${courseId}`;

    document.querySelector('#backToCourseButton').href =
      `./manage-course.html?id=${courseId}`;

    document.querySelector('#cancelAlterLink').href =
      `./manage-course.html?id=${courseId}`;

    container.innerHTML = '';

    const allocations = currentCourse.allocations || [];

    if (allocations.length) {
      allocations.forEach((allocation) => {
        container.appendChild(allocationRow(allocation));
      });
    } else {
      container.appendChild(allocationRow());
    }

    updateWorkflowFields();
    configureCourseLifecycle(currentCourse, form);
  } catch (error) {
    showMessage(error.message);
  }
}

courseTypeInput.addEventListener('change', updateWorkflowFields);

addButton.addEventListener('click', () => {
  container.appendChild(allocationRow());
  updateWorkflowFields();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();

  try {
    const totalSeats = getRequiredPositiveInteger(
      '#totalSeats',
      'إجمالي المقاعد النهائية'
    );

    const { allocations, directEmployeeIds } =
      collectAllocationsAndNewEmployees();

    const selectedCourseType = courseTypeInput.value;
    const rawStatus = document.querySelector('#courseStatus').value;
    if (rawStatus === 'ARCHIVED' && !document.querySelector('#finalReportFile').files[0]) {
      throw new Error('ارفع التقرير النهائي قبل أرشفة الدورة.');
    }

    const status =
      selectedCourseType === 'TRAINING' && rawStatus === 'ACTIVE'
        ? 'OPEN_FOR_NOMINATION'
        : rawStatus;

    const courseData = {
      courseNo: getOptionalText('#courseNumber'),
      courseType: selectedCourseType,
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
        selectedCourseType === 'TRAINING'
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
    const finalReport = document.querySelector('#finalReportFile').files[0];
    if (finalReport) formData.append('finalReport', finalReport);

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

formData.append(
  'removedCourseFormIds',
  JSON.stringify(removedCourseFormIds)
);

templateFiles.forEach((file) => {
  formData.append('courseFormTemplates', file);
});

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'جارٍ الحفظ...';

    await api(`/api/courses/${courseId}`, {
      method: 'PATCH',
      body: formData,
    });

    showMessage('تم حفظ تعديلات الدورة بنجاح.', 'success');

    setTimeout(() => {
      window.location.href = ['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(rawStatus)
        ? './archive.html'
        : `./manage-course.html?id=${courseId}`;
    }, 700);
  } catch (error) {
    showMessage(error.message);
  } finally {
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = false;
    submitButton.textContent = 'حفظ التعديلات';
  }
});
addButton.addEventListener('click', () => {
  container.appendChild(allocationRow());
  updateWorkflowFields();
});

addCourseFormButton.addEventListener('click', addCourseFormRow);
initialize();
