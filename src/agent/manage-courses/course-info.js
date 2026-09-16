import { protectPage } from '../../shared/auth-guard.js';

import {
  api,
  getQuery,
  escapeHtml,
  formatDate,
  courseStatusText,
  nominationStatusText,
} from '../agent-api.js';

const courseId = getQuery('id');

let nominations = [];

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value || '—';
  }
}

function showMessage(message, type = 'error') {
  const element = document.querySelector('#nominationsMessage');

  element.textContent = message;
  element.className =
    type === 'success'
      ? 'mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700'
      : 'mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700';

  element.classList.remove('hidden');
}

function statusClass(status) {
  const classes = {
    PENDING: 'bg-amber-50 text-amber-700',
    PENDING_AGENT: 'bg-amber-50 text-amber-700',
    AGENT_APPROVED: 'bg-emerald-50 text-emerald-700',
    AGENT_REJECTED: 'bg-rose-50 text-rose-700',
    SELECTED: 'bg-blue-50 text-blue-700',
  };

  return classes[status] || 'bg-slate-100 text-slate-600';
}

function updateSelectionState() {
  const checkboxes = [
    ...document.querySelectorAll('.nomination-checkbox'),
  ];

  const selected = checkboxes.filter((checkbox) => checkbox.checked);

  document.querySelector('#selectedNominationsCount').textContent =
    selected.length
      ? `تم تحديد ${selected.length} مرشح`
      : 'لم يتم تحديد مرشحين';

  document.querySelector('#confirmNominationsButton').disabled =
    selected.length === 0;
document.querySelector('#rejectNominationsButton').disabled =
  selected.length === 0;
  const selectAll = document.querySelector('#selectAllNominations');

  if (selectAll) {
    selectAll.checked =
      checkboxes.length > 0 && selected.length === checkboxes.length;
  }
}

function renderNominations(items) {
  const body = document.querySelector('#nominationsTableBody');

  if (!items.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-10 text-center text-xs text-slate-400">
          لا توجد ترشيحات من مديري الأقسام حاليًا.
        </td>
      </tr>
    `;

    document.querySelector('#nominationsCountText').textContent =
      'لا توجد ترشيحات بانتظار المراجعة.';

    updateSelectionState();
    return;
  }

  document.querySelector('#nominationsCountText').textContent =
    `إجمالي الترشيحات: ${items.length}`;

  body.innerHTML = items
    .map((nomination) => {
      const pending =
        nomination.status === 'PENDING' ||
        nomination.status === 'PENDING_AGENT';

      return `
        <tr class="hover:bg-slate-50">
          <td class="px-5 py-3">
            ${
              pending
                ? `
                  <input
                    type="checkbox"
                    value="${nomination.id}"
                    class="nomination-checkbox h-4 w-4 accent-[#C9A227]"
                  />
                `
                : ''
            }
          </td>

          <td class="px-5 py-3">
            <p class="font-bold text-slate-800">
              ${escapeHtml(nomination.employee_name)}
            </p>
          </td>

          <td class="px-5 py-3 text-slate-600">
            ${escapeHtml(nomination.employee_number || '—')}
          </td>

          <td class="px-5 py-3 text-slate-600">
            ${escapeHtml(nomination.department_name || '—')}
          </td>

          <td class="px-5 py-3 text-slate-600">
            ${escapeHtml(nomination.manager_name || '—')}
          </td>

          <td class="px-5 py-3 text-slate-500">
            ${formatDate(nomination.created_at)}
          </td>

          <td class="px-5 py-3">
            <span class="rounded-lg px-2 py-1 text-[10px] font-bold ${statusClass(nomination.status)}">
              ${nominationStatusText(nomination.status)}
            </span>
          </td>
        </tr>
      `;
    })
    .join('');

  document.querySelectorAll('.nomination-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', updateSelectionState);
  });

  updateSelectionState();
}

function renderAttachments(attachments) {
  const container = document.querySelector('#courseAttachmentsList');

  if (!attachments.length) {
    container.textContent = 'لا توجد مرفقات متاحة حاليًا.';
    return;
  }

  container.innerHTML = attachments
    .map(
      (attachment) => `
        <a
          href="${escapeHtml(attachment.file_url)}"
          target="_blank"
          rel="noopener"
          class="ml-2 mb-2 inline-block rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-brand-darkGold transition hover:bg-brand-lightGold"
        >
          ${escapeHtml(attachment.attachment_type)}:
          ${escapeHtml(attachment.original_name)}
        </a>
      `
    )
    .join('');
}

function fillCourseData(data) {
  const course = data.course || {};
  const allocation = data.sectorAllocation || {};

  setText('#courseTitle', course.title);
  setText('#courseNumber', course.course_no || 'بدون رقم');
  setText('#providerName', course.provider || '—');
  setText('#courseLocation', course.location || '—');

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

  setText('#courseDescription', course.description || 'لا يوجد وصف.');
  setText('#sectorName', data.sector?.name || '—');
  setText('#sectorNominationLimit', allocation.nomination_limit || 0);
  setText('#sectorNominationsCount', allocation.nominations_count || 0);

  const typeBadge = document.querySelector('#courseTypeBadge');
  const statusBadge = document.querySelector('#courseStatusBadge');

  typeBadge.textContent =
    course.course_type === 'MISSION'
      ? 'مهمة / بعثة'
      : 'دورة تدريبية';

  statusBadge.textContent = courseStatusText(course.status);

  nominations = data.nominations || [];

  renderNominations(nominations);
  renderAttachments(data.attachments || []);
}

function getSelectedNominationIds() {
  return [
    ...document.querySelectorAll('.nomination-checkbox:checked'),
  ].map((checkbox) => Number(checkbox.value));
}

async function decideSelectedNominations(isConfirmed, reason = null) {
  const nominationIds = getSelectedNominationIds();

  if (!nominationIds.length) {
    showMessage('حدد مرشحًا واحدًا على الأقل.');
    return;
  }

  const confirmButton = document.querySelector(
    '#confirmNominationsButton'
  );

  const rejectButton = document.querySelector(
    '#rejectNominationsButton'
  );

  confirmButton.disabled = true;
  rejectButton.disabled = true;

  try {
    const data = await api(
      `/api/agent/courses/${courseId}/nominations/decision`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nominationIds,
          isConfirmed,
          reason,
        }),
      }
    );

    showMessage(
      data.message ||
        (isConfirmed
          ? 'تم اعتماد المرشحين المحددين.'
          : 'تم رفض المرشحين المحددين.'),
      'success'
    );

    await loadCourseInfo();
  } catch (error) {
    showMessage(error.message);
  } finally {
    confirmButton.disabled = false;
    rejectButton.disabled = false;
  }
}

function openRejectModal() {
  const ids = getSelectedNominationIds();

  if (!ids.length) {
    showMessage('حدد مرشحًا واحدًا على الأقل.');
    return;
  }

  document.querySelector('#rejectionReason').value = '';
  document.querySelector('#rejectionModalError').classList.add('hidden');

  const modal = document.querySelector('#rejectNominationsModal');

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeRejectModal() {
  const modal = document.querySelector('#rejectNominationsModal');

  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function confirmRejectNominations() {
  const reason = document.querySelector('#rejectionReason').value.trim();
  const errorBox = document.querySelector('#rejectionModalError');

  if (!reason) {
    errorBox.textContent = 'سبب رفض الترشيحات مطلوب.';
    errorBox.classList.remove('hidden');
    return;
  }

  closeRejectModal();

  await decideSelectedNominations(false, reason);
}

async function loadCourseInfo() {
  const data = await api(`/api/agent/courses/${courseId}`);
  fillCourseData(data);
}

async function initialize() {
  const user = await protectPage(['AGENT']);

  if (!user) return;

  if (!courseId) {
    window.location.replace('./main-courses.html');
    return;
  }

  document
    .querySelector('#selectAllNominations')
    .addEventListener('change', (event) => {
      document
        .querySelectorAll('.nomination-checkbox')
        .forEach((checkbox) => {
          checkbox.checked = event.target.checked;
        });

      updateSelectionState();
    });

  document
  .querySelector('#confirmNominationsButton')
  .addEventListener('click', () => {
    decideSelectedNominations(true);
  });

document
  .querySelector('#rejectNominationsButton')
  .addEventListener('click', openRejectModal);

document
  .querySelector('#closeRejectNominationsModalButton')
  .addEventListener('click', closeRejectModal);

document
  .querySelector('#confirmRejectNominationsButton')
  .addEventListener('click', confirmRejectNominations);
  
  try {
    await loadCourseInfo();
  } catch (error) {
    console.error('Agent course info error:', error);
    setText('#courseTitle', error.message || 'تعذر تحميل تفاصيل الدورة.');
  }
}

initialize();