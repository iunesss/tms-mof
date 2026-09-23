import { protectPage } from '../../shared/auth-guard.js';
import { renderFinalReport } from '../../shared/final-report.js';
import {
  courseStatusText,
  nominationStatusText,
  candidateStatusText,
  formStatusText,
  attachmentTypeText,
} from '../../shared/status-labels.js';
import { notify } from '../../shared/notify.js';

const courseId = new URLSearchParams(window.location.search).get('id');
const openedFromArchive =
  new URLSearchParams(window.location.search).get('from') === 'archive';

let availableEmployees = [];
let currentCourse = null;
let currentUserId = null;
let participantsOnly = false;
let remainingNominationSlots = 0;

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

  if (!response.ok) {
    throw new Error(data.message || 'تعذر تنفيذ الطلب.');
  }

  return data;
}

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value || '—';
  }
}

function showEditorMessage(message, type = 'error') {
  const element = document.querySelector('#nominationEditorMessage');

  element.textContent = message;

  element.className =
    type === 'success'
      ? 'mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700'
      : 'mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700';

  element.classList.remove('hidden');
}

function updateSelectionState() {
  const selected = [
    ...document.querySelectorAll('.employee-checkbox:checked'),
  ];

  document.querySelector('#selectedEmployeesCount').textContent =
    selected.length
      ? `تم اختيار ${selected.length} موظف`
      : 'لم يتم اختيار موظفين';

  document.querySelector('#submitNominationsButton').disabled =
    selected.length === 0;

  document.querySelectorAll('.employee-checkbox:not(:checked)').forEach((checkbox) => {
    checkbox.disabled = selected.length >= remainingNominationSlots;
  });
  const selectAll = document.querySelector('#selectAllEmployees');

  selectAll.checked =
    availableEmployees.length > 0 &&
    selected.length === availableEmployees.length;
}

function renderAvailableEmployees(employees) {
  const body = document.querySelector('#availableEmployeesTableBody');

  if (!employees.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="px-5 py-10 text-center text-xs text-slate-400">
          لا يوجد موظفون متاحون للترشيح في القسم.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = employees
    .map(
      (employee) => `
        <tr class="hover:bg-slate-50">
          <td class="px-5 py-3">
            <input
              type="checkbox"
              value="${employee.id}"
              class="employee-checkbox h-4 w-4 accent-[#C9A227]"
            />
          </td>

          <td class="px-5 py-3">
            <p class="font-bold text-slate-800">
              ${escapeHtml(employee.full_name)}
            </p>

            ${
              Number(employee.id) === Number(currentUserId)
                ? '<p class="mt-1 text-[10px] font-bold text-brand-darkGold">أنت</p>'
                : ''
            }
          </td>

          <td class="px-5 py-3 text-slate-600">
            ${escapeHtml(employee.employee_number || '—')}
          </td>

          <td class="px-5 py-3 text-slate-600">
            ${escapeHtml(employee.job_title || '—')}
          </td>

          <td class="px-5 py-3 text-slate-500">
            حدّد لإضافة الموظف إلى الترشيحات
          </td>
        </tr>
      `
    )
    .join('');

  document.querySelectorAll('.employee-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', updateSelectionState);
  });

  updateSelectionState();
}

function renderNominations(nominations) {
  const body = document.querySelector(
    '#departmentNominationsTableBody'
  );

  document.querySelector('#departmentCandidatesText').textContent =
    nominations.length
      ? participantsOnly
        ? `إجمالي المشاركين من القسم: ${nominations.length}`
        : `إجمالي ترشيحات القسم: ${nominations.length}`
      : participantsOnly
        ? 'لا يوجد موظفون مشاركون من القسم في هذه الدورة.'
        : 'لا توجد ترشيحات للقسم حتى الآن.';

  if (!nominations.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="px-5 py-10 text-center text-xs text-slate-400">
          ${
            participantsOnly
              ? 'لا يوجد موظفون مشاركون من القسم في هذه الدورة.'
              : 'لا توجد ترشيحات للقسم.'
          }
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = nominations
    .map(
      (nomination) => `
        <tr class="hover:bg-slate-50">
          <td class="px-5 py-3 font-bold text-slate-800">
            ${escapeHtml(nomination.employee_name)}
          </td>

          <td class="px-5 py-3 text-slate-600">
            ${escapeHtml(nomination.employee_number || '—')}
          </td>

          <td class="px-5 py-3 text-slate-500">
            ${formatDate(nomination.created_at)}
          </td>

          <td class="px-5 py-3">
            <span class="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
              ${participantsOnly
                ? candidateStatusText(nomination.status)
                : nominationStatusText(nomination.status)}
            </span>
          </td>

          <td class="px-5 py-3 text-slate-500">
            ${
              participantsOnly
                ? 'شارك ضمن موظفي القسم'
                : escapeHtml(nomination.reason || '—')
            }
          </td>
        </tr>
      `
    )
    .join('');
}

function renderAttachments(attachments) {
  const container = document.querySelector(
    '#courseAttachmentsList'
  );

  if (!attachments.length) {
    container.textContent = 'لا توجد أجندة أو مرفقات حاليًا.';
    return;
  }

  container.innerHTML = attachments
    .map(
      (attachment) => `
        <a
          href="${escapeHtml(attachment.file_url)}"
          target="_blank"
          rel="noopener"
          class="ml-2 mb-2 inline-block rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-brand-darkGold"
        >
          ${escapeHtml(attachmentTypeText(attachment.attachment_type))}:
          ${escapeHtml(attachment.original_name)}
        </a>
      `
    )
    .join('');
}

function renderSelfCourseForms(forms, canUpload) {
  const section = document.querySelector('#selfCandidateSection');
  const container = document.querySelector('#selfCourseFormsList');

  if (!forms?.length) {
    section.classList.remove('hidden');
    container.textContent = 'لا توجد استمارات مطلوبة لهذه الدورة.';
    return;
  }

  section.classList.remove('hidden');

  container.innerHTML = forms
    .map(
      (form) => `
        <article class="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-xs font-bold text-slate-800">
                ${escapeHtml(form.title)}
              </p>

              <p class="mt-1 text-[11px] ${
                Number(form.is_required)
                  ? 'text-rose-600'
                  : 'text-slate-500'
              }">
                ${
                  Number(form.is_required)
                    ? 'استمارة إلزامية'
                    : 'استمارة اختيارية'
                }
              </p>
              <p class="mt-1 text-[11px] text-slate-500">
                الحالة: ${form.submission_status
                  ? formStatusText(form.submission_status)
                  : 'لم تُرفع بعد'}
              </p>
            </div>

            <a
              href="${escapeHtml(form.template_file_url)}"
              target="_blank"
              rel="noopener"
              class="w-fit rounded-lg border border-brand-gold px-3 py-1.5 text-[11px] font-bold text-brand-darkGold"
            >
              تحميل الاستمارة
            </a>
          </div>

          ${form.submitted_file_url ? `
            <a href="${escapeHtml(form.submitted_file_url)}" target="_blank" rel="noopener"
               class="mt-3 inline-block text-[11px] font-semibold text-brand-darkGold underline">
              عرض نسختي المرفوعة
            </a>
          ` : ''}

          ${canUpload ? `<div class="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              data-form-id="${form.id}"
              type="file"
              class="self-form-file flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px]"
            />

            <button
              data-form-id="${form.id}"
              type="button"
              class="upload-self-form-button rounded-lg bg-brand-gold px-4 py-2 text-[11px] font-bold text-white"
            >
              رفع النسخة المعبأة
            </button>
          </div>` : ''}
        </article>
      `
    )
    .join('');
}

function renderSelfCandidateAttachments(attachments = []) {
  const section = document.querySelector('#selfCandidateAttachmentsSection');
  const container = document.querySelector('#selfCandidateAttachmentsList');

  section.classList.remove('hidden');
  if (!attachments.length) {
    container.textContent = 'لم تُرسل لك تذكرة أو تأشيرة أو مستندات خاصة حتى الآن.';
    return;
  }

  container.innerHTML = attachments.map((attachment) => `
    <a href="${escapeHtml(attachment.file_url)}" target="_blank" rel="noopener"
       class="ml-2 mb-2 inline-block rounded-lg bg-slate-50 px-3 py-2 font-semibold text-brand-darkGold">
      ${escapeHtml(attachmentTypeText(attachment.attachment_type))}: ${escapeHtml(attachment.original_name)}
    </a>
  `).join('');
}

function fillPage(data) {
  const course = data.course || {};
  const allocation = data.departmentAllocation || {};

  currentCourse = course;
  participantsOnly = data.participants_only === true;
  remainingNominationSlots = Math.max(
    Number(allocation.nomination_limit || 0) -
      Number(allocation.nominations_count || 0),
    0
  );

  const isReadOnlyMission =
    data.read_only === true ||
    course.course_type === 'MISSION';

  setText('#courseTitle', course.title);
  setText('#courseNumber', course.course_no || 'بدون رقم');
  setText('#providerName', course.provider || '—');
  setText('#courseLocation', course.location || '—');
  setText('#courseDescription', course.description || 'لا يوجد وصف.');
  const participation = data.selfParticipation;
  document.querySelector('#selfParticipationStatus').textContent = participation
    ? participation.type === 'CANDIDATE'
      ? candidateStatusText(participation.status)
      : nominationStatusText(participation.status)
    : 'غير مرشح في هذه الدورة';

  setText(
    '#departmentNominationLimit',
    isReadOnlyMission
      ? 'لا ينطبق على المهمة'
      : allocation.nomination_limit || 0
  );

  setText(
    '#departmentNominationsCount',
    allocation.nominations_count || 0
  );

  setText(
    '#courseDates',
    `${formatDate(course.start_date)} إلى ${formatDate(course.end_date)}`
  );

  setText(
    '#nominationDeadline',
    course.course_type === 'TRAINING'
      ? formatDate(course.nomination_deadline)
      : 'لا ينطبق على المهمة'
  );

  document.querySelector('#courseTypeBadge').textContent =
    course.course_type === 'MISSION'
      ? 'مهمة / بعثة'
      : 'دورة تدريبية';

  document.querySelector('#courseStatusBadge').textContent =
    courseStatusText(course.status);

  availableEmployees = isReadOnlyMission
    ? []
    : data.availableEmployees || [];

  const editor = document.querySelector('#nominationEditorSection');

  /*
    المهمة: للعرض فقط.
    التدريب: يبقى مفتوحًا ما دام هناك مقعد ترشيح متبقٍ والموعد لم ينتهِ.
  */
  if (isReadOnlyMission || data.submission_locked) {
    editor.classList.add('hidden');
  } else {
    editor.classList.remove('hidden');
    renderAvailableEmployees(availableEmployees);
  }

  renderNominations(data.nominations || []);
  document.querySelector('#departmentCandidatesTitle').textContent =
    participantsOnly ? 'الموظفون المشاركون من القسم' : 'مرشحو القسم';
  renderAttachments(data.attachments || []);
  renderFinalReport(data.final_report, course.status);

  const selfCandidateSection = document.querySelector(
    '#selfCandidateSection'
  );

  if (data.selfCandidate) {
    const closedCourseStatuses = ['COMPLETED', 'ARCHIVED', 'CANCELLED'];
    const acceptedCandidateStatuses = [
      'PRELIMINARILY_ACCEPTED',
      'CONFIRMED',
      'PARTICIPATING',
      'COMPLETED',
    ];
    const canUploadForms =
      !closedCourseStatuses.includes(course.status) &&
      !acceptedCandidateStatuses.includes(data.selfParticipation?.status);

    document.querySelector('#selfFormsDescription').textContent = canUploadForms
      ? 'حمّل الاستمارة، عبئها، ثم ارفع النسخة المعبأة.'
      : 'يمكنك تحميل الاستمارة وعرض النسخة التي رفعتها سابقًا.';
    renderSelfCourseForms(data.selfCourseForms || [], canUploadForms);
    renderSelfCandidateAttachments(data.selfCandidateAttachments || []);
  } else {
    selfCandidateSection.classList.add('hidden');
    document.querySelector('#selfCandidateAttachmentsSection').classList.add('hidden');
  }
}

async function loadCourse() {
  const data = await api(`/api/courses/${courseId}`);
  fillPage(data);
}

async function submitNominations() {
  /*
    حماية إضافية حتى لو حاول شخص استدعاء الدالة يدويًا.
  */
  if (currentCourse?.course_type === 'MISSION') {
    showEditorMessage(
      'المهمة للعرض فقط، ولا يمكن إرسال ترشيحات فيها.'
    );

    return;
  }

  const employeeUserIds = [
    ...document.querySelectorAll('.employee-checkbox:checked'),
  ].map((checkbox) => Number(checkbox.value));

  if (!employeeUserIds.length) {
    showEditorMessage('حدد موظفًا واحدًا على الأقل.');
    return;
  }

  const button = document.querySelector(
    '#submitNominationsButton'
  );

  button.disabled = true;
  button.textContent = 'جارٍ إرسال الترشيحات...';

  try {
    const data = await api(
      `/api/courses/${courseId}/nominations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ employeeUserIds }),
      }
    );

    showEditorMessage(
      data.message || 'تم إرسال الترشيحات إلى وكيل القطاع.',
      'success'
    );

    await loadCourse();
  } catch (error) {
    showEditorMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'إرسال الترشيحات للوكيل';
  }
}

async function initialize() {
  const user = await protectPage(['DEPARTMENT_MANAGER']);

  if (!user) return;

  currentUserId = user.id || user.userId || user.user_id;

  if (openedFromArchive) {
    document.querySelector('#backToCoursesLogo').href = './archive.html';
    const backButton = document.querySelector('#backToCoursesButton');
    backButton.href = './archive.html';
    backButton.textContent = 'العودة إلى السجل';
  }

  if (!courseId) {
    window.location.replace('./main-courses.html');
    return;
  }

  document.querySelector('#selectAllEmployees').addEventListener(
    'change',
    (event) => {
      document
        .querySelectorAll('.employee-checkbox')
        .forEach((checkbox, index) => {
          checkbox.checked =
            event.target.checked && index < remainingNominationSlots;
        });

      updateSelectionState();
    }
  );

  document
    .querySelector('#submitNominationsButton')
    .addEventListener('click', submitNominations);
document.querySelector('#selfCourseFormsList').addEventListener(
  'click',
  async (event) => {
    const button = event.target.closest('.upload-self-form-button');
    if (!button) return;

    const formId = Number(button.dataset.formId);
    const fileInput = [...document.querySelectorAll('.self-form-file')]
      .find((input) => Number(input.dataset.formId) === formId);

    const file = fileInput?.files?.[0];

    if (!file) {
      notify('اختر الاستمارة المعبأة أولًا.');
      return;
    }

    button.disabled = true;
    button.textContent = 'جارٍ الرفع...';

    try {
      const body = new FormData();
      body.append('formFile', file);

      await api(
        `/api/courses/${courseId}/forms/${formId}/submission`,
        { method: 'POST', body }
      );

      notify('تم رفع الاستمارة بنجاح.', 'success');
      await loadCourse();
    } catch (error) {
      notify(error.message || 'تعذر رفع الاستمارة.');
      button.disabled = false;
      button.textContent = 'رفع النسخة المعبأة';
    }
  }
);
  try {
    await loadCourse();
  } catch (error) {
    setText(
      '#courseTitle',
      error.message || 'تعذر تحميل الدورة.'
    );
  }
}

initialize();
