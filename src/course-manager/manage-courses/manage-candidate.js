import { protectPage } from '../../shared/auth-guard.js';

import {
  api,
  getQuery,
  escapeHtml,
  formatDate,
  candidateStatusText,
} from './course-api.js';

const courseId = getQuery('courseId');
const candidateId = getQuery('candidateId');

let selectedDocumentId = null;

function setText(selector, value) {
  document.querySelector(selector).textContent = value || '—';
}

function showModal(selector) {
  const modal = document.querySelector(selector);
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeModal(selector) {
  const modal = document.querySelector(selector);
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function showModalError(selector, message) {
  const errorBox = document.querySelector(selector);
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideModalError(selector) {
  const errorBox = document.querySelector(selector);
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

function renderDocuments(documents) {
  const body = document.querySelector('#candidateDocumentsTableBody');

  if (!documents.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="px-5 py-8 text-center text-xs text-slate-400">
          لا توجد مستندات خاصة بهذه الدورة حتى الآن.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = documents.map((document) => `
    <tr>
      <td class="px-5 py-3 font-semibold text-slate-800">
        ${escapeHtml(document.requirement_name)}
      </td>

      <td class="px-5 py-3">
        ${
          document.file_url
            ? `
              <a
                href="${escapeHtml(document.file_url)}"
                target="_blank"
                class="font-bold text-brand-darkGold"
              >
                عرض الملف
              </a>
            `
            : 'لم يتم الرفع'
        }
      </td>

      <td class="px-5 py-3">
        ${formatDate(document.uploaded_at)}
      </td>

      <td class="px-5 py-3">
        ${escapeHtml(document.status || 'بانتظار الرفع')}
      </td>

      <td class="max-w-xs px-5 py-3 text-slate-500">
        ${escapeHtml(document.review_reason || '—')}
      </td>

      <td class="px-5 py-3">
        <div class="flex gap-2">
          <button
            type="button"
            data-document-id="${document.id}"
            class="request-resubmission rounded-lg border border-brand-gold px-2.5 py-1.5 text-[11px] font-bold text-brand-darkGold transition hover:bg-brand-lightGold"
          >
            طلب إعادة رفع
          </button>

          <button
            type="button"
            data-document-id="${document.id}"
            class="approve-document rounded-lg border border-emerald-200 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-50"
          >
            اعتماد
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('.request-resubmission').forEach((button) => {
    button.addEventListener('click', () => {
      selectedDocumentId = button.dataset.documentId;

      document.querySelector('#resubmissionReason').value = '';
      hideModalError('#resubmissionModalError');

      showModal('#resubmissionModal');
    });
  });

  document.querySelectorAll('.approve-document').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(
          `/api/admin/courses/${courseId}/candidates/${candidateId}/documents/${button.dataset.documentId}/review`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              decision: 'APPROVED',
              reason: null,
            }),
          }
        );

        await loadCandidate();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderLinks(selector, files, emptyText) {
  const element = document.querySelector(selector);

  if (!files?.length) {
    element.textContent = emptyText;
    return;
  }

  element.innerHTML = files.map((file) => `
    <a
      href="${escapeHtml(file.file_url)}"
      target="_blank"
      class="ml-2 inline-block rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-brand-darkGold"
    >
      ${escapeHtml(file.name || file.original_name)}
    </a>
  `).join('');
}

function renderStatusHistory(history) {
  const element = document.querySelector('#candidateStatusHistory');

  if (!history?.length) {
    element.textContent = 'لا يوجد سجل حالات حتى الآن.';
    return;
  }

  element.innerHTML = `
    <div class="space-y-3">
      ${history.map((item) => `
        <div class="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
          <p class="font-bold text-slate-800">
            ${candidateStatusText(item.from_status)} ← ${candidateStatusText(item.to_status)}
          </p>
          <p class="mt-1 text-slate-500">
            ${escapeHtml(item.reason || 'بدون ملاحظة')} — ${formatDate(item.changed_at)}
          </p>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadCandidate() {
  const data = await api(
    `/api/admin/courses/${courseId}/candidates/${candidateId}`
  );

  const candidate = data.candidate || data;
  const snapshot = candidate.snapshot || {};

  setText('#courseName', candidate.course_title);
  setText('#candidateName', candidate.full_name);
  setText('#candidateEmployeeNumber', candidate.employee_number);

  document.querySelector('#candidateStatusBadge').textContent =
    candidateStatusText(candidate.status);

  setText('#snapshotFullName', snapshot.full_name || candidate.full_name);
  setText(
    '#snapshotEmployeeNumber',
    snapshot.employee_number || candidate.employee_number
  );
  setText('#snapshotDepartment', snapshot.department_name);
  setText('#snapshotSector', snapshot.sector_name);
  setText('#snapshotJobTitle', snapshot.job_title);
  setText('#snapshotEmail', snapshot.email);
  setText('#snapshotPhone', snapshot.phone);
  setText('#candidateSelectedAt', formatDate(candidate.selected_at));

  renderDocuments(candidate.documents || []);

  renderLinks(
    '#candidateFormsList',
    candidate.forms,
    'لا توجد نماذج مرفوعة حاليًا.'
  );

  renderLinks(
    '#profileDocumentsList',
    candidate.profile_documents,
    'لا توجد مستندات ملف شخصي متاحة.'
  );

  renderStatusHistory(candidate.status_history || []);

  document.querySelector('#backToCourseLink').href =
  `./manage-course.html?id=${courseId}`;

document.querySelector('#backToCourseButton').href =
  `./manage-course.html?id=${courseId}`;
}

async function updateCandidateStatus(status, reason = null) {
  await api(
    `/api/admin/courses/${courseId}/candidates/${candidateId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
        reason,
      }),
    }
  );

  await loadCandidate();
}

document.querySelector('#preliminaryAcceptButton').addEventListener('click', () => {
  updateCandidateStatus('PRELIMINARILY_ACCEPTED')
    .catch((error) => alert(error.message));
});

document.querySelector('#confirmCandidateButton').addEventListener('click', () => {
  updateCandidateStatus('CONFIRMED')
    .catch((error) => alert(error.message));
});

document.querySelector('#finalRejectCandidateButton').addEventListener('click', () => {
  document.querySelector('#finalRejectionReason').value = '';
  hideModalError('#finalRejectModalError');
  showModal('#finalRejectModal');
});

document.querySelector('#closeFinalRejectModalButton').addEventListener('click', () => {
  closeModal('#finalRejectModal');
});

document.querySelector('#confirmFinalRejectButton').addEventListener('click', async () => {
  const reason = document.querySelector('#finalRejectionReason').value.trim();

  if (!reason) {
    showModalError('#finalRejectModalError', 'سبب الرفض النهائي مطلوب.');
    return;
  }

  try {
    await updateCandidateStatus('REJECTED', reason);
    closeModal('#finalRejectModal');
  } catch (error) {
    showModalError('#finalRejectModalError', error.message);
  }
});

document.querySelector('#closeResubmissionModalButton').addEventListener('click', () => {
  closeModal('#resubmissionModal');
});

document.querySelector('#confirmResubmissionButton').addEventListener('click', async () => {
  const reason = document.querySelector('#resubmissionReason').value.trim();

  if (!reason) {
    showModalError(
      '#resubmissionModalError',
      'يرجى كتابة ملاحظة واضحة للموظف.'
    );
    return;
  }

  if (!selectedDocumentId) {
    showModalError(
      '#resubmissionModalError',
      'لم يتم تحديد المستند المطلوب إعادة رفعه.'
    );
    return;
  }

  try {
    await api(
      `/api/admin/courses/${courseId}/candidates/${candidateId}/documents/${selectedDocumentId}/review`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          decision: 'REJECTED',
          reason,
        }),
      }
    );

    closeModal('#resubmissionModal');
    await loadCandidate();
  } catch (error) {
    showModalError('#resubmissionModalError', error.message);
  }
});

async function initialize() {
  const session = await protectPage(['COURSE_MANAGER']);

  if (!session) return;

  if (!courseId || !candidateId) {
window.location.replace('./main-courses.html');
    return;
  }

  try {
    await loadCandidate();
  } catch (error) {
    document.querySelector('#candidateName').textContent = error.message;
  }
}

initialize();