import { protectPage } from '../../shared/auth-guard.js';
import { notify } from '../../shared/notify.js';

import {
  api,
  getQuery,
  escapeHtml,
  formatDate,
  candidateStatusText,
} from './course-api.js';

const courseId = getQuery('courseId');
const candidateId = getQuery('candidateId');

let selectedReview = null;

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value || '—';
  }
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
  const element = document.querySelector(selector);

  element.textContent = message;
  element.classList.remove('hidden');
}

function hideModalError(selector) {
  const element = document.querySelector(selector);

  element.textContent = '';
  element.classList.add('hidden');
}

function showAttachmentMessage(message, type = 'error') {
  const element = document.querySelector('#candidateAttachmentMessage');

  element.textContent = message;

  element.className =
    type === 'success'
      ? 'mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700'
      : 'mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700';

  element.classList.remove('hidden');
}

function attachmentTypeText(type) {
  const labels = {
    VISA: 'فيزا / تأشيرة',
    TRAVEL_TICKET: 'تذكرة سفر',
    OFFICIAL_LETTER: 'خطاب رسمي',
    TRAVEL_DOCUMENT: 'مستند سفر',
    OTHER: 'مستند آخر',
  };

  return labels[type] || type || 'مستند';
}

function submissionStatusText(status) {
  const labels = {
    PENDING: 'بانتظار الرفع',
    SUBMITTED: 'مرفوعة وتنتظر المراجعة',
    UNDER_REVIEW: 'قيد المراجعة',
    APPROVED: 'معتمدة',
    REJECTED: 'مرفوضة وتحتاج إعادة رفع',
    RESUBMITTED: 'أُعيد رفعها وتنتظر المراجعة',
  };

  return labels[status] || status || '—';
}

function profileDocumentStatusText(status) {
  const labels = {
    PENDING: 'بانتظار المراجعة',
    UNDER_REVIEW: 'قيد المراجعة',
    APPROVED: 'معتمد',
    REJECTED: 'مرفوض ويحتاج إعادة رفع',
  };

  return labels[status] || status || '—';
}

function openReviewModal(kind, id, title) {
  selectedReview = { kind, id };

  document.querySelector('#resubmissionModalTitle').textContent =
    `رفض ${title} وطلب إعادة الرفع`;

  document.querySelector('#resubmissionReason').value = '';

  hideModalError('#resubmissionModalError');
  showModal('#resubmissionModal');
}

async function reviewItem(kind, id, decision, reason = null) {
  const urls = {
    form:
      `/api/courses/${courseId}/candidates/${candidateId}/forms/${id}/review`,

    profile:
      `/api/courses/${courseId}/candidates/${candidateId}/profile-documents/${id}/review`,
  };

  await api(urls[kind], {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision,
      reason,
    }),
  });
}

function renderForms(forms = []) {
  const container = document.querySelector('#candidateFormsList');

  if (!forms.length) {
    container.textContent = 'لا توجد استمارات مضافة لهذه الدورة.';
    return;
  }

  container.innerHTML = `
    <div class="space-y-3">
      ${forms.map((form) => `
        <article class="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p class="text-xs font-bold text-slate-800">
                ${escapeHtml(form.title)}
              </p>

              <p class="mt-1 text-[11px] text-slate-500">
                ${Number(form.is_required) ? 'استمارة إلزامية' : 'استمارة اختيارية'}
                — ${submissionStatusText(form.status)}
              </p>

              ${
                form.rejection_reason
                  ? `
                    <p class="mt-2 text-[11px] text-rose-700">
                      سبب الرفض: ${escapeHtml(form.rejection_reason)}
                    </p>
                  `
                  : ''
              }
            </div>

            <div class="flex flex-wrap gap-2">
              ${
                form.file_url
                  ? `
                    <a
                      href="${escapeHtml(form.file_url)}"
                      target="_blank"
                      rel="noopener"
                      class="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-white"
                    >
                      فتح النسخة المرفوعة
                    </a>

                    <button
                      type="button"
                      data-form-id="${form.id}"
                      class="approve-form rounded-lg border border-emerald-200 px-3 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      اعتماد الاستمارة
                    </button>

                    <button
                      type="button"
                      data-form-id="${form.id}"
                      class="reject-form rounded-lg border border-rose-200 px-3 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                    >
                      رفض
                    </button>
                  `
                  : `
                    <span class="rounded-lg bg-white px-3 py-1.5 text-[11px] text-slate-400">
                      لم يرفع الموظف نسخة بعد
                    </span>
                  `
              }
            </div>
          </div>
        </article>
      `).join('')}
    </div>
  `;

  document.querySelectorAll('.approve-form').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await reviewItem(
          'form',
          button.dataset.formId,
          'APPROVED'
        );

        await loadCandidate();
      } catch (error) {
        notify(error.message);
      }
    });
  });

  document.querySelectorAll('.reject-form').forEach((button) => {
    button.addEventListener('click', () => {
      openReviewModal(
        'form',
        button.dataset.formId,
        'الاستمارة'
      );
    });
  });
}

function renderProfileDocuments(documents = []) {
  const container = document.querySelector('#profileDocumentsList');

  if (!documents.length) {
    container.textContent = 'لا توجد مستندات ملف شخصي متاحة.';
    return;
  }

  container.innerHTML = `
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      ${documents.map((document) => `
        <article class="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs font-bold text-slate-800">
            ${escapeHtml(document.label || document.document_type)}
          </p>

          <p class="mt-1 text-[11px] text-slate-500">
            الحالة: ${profileDocumentStatusText(document.status)}
          </p>

          ${
            document.rejection_reason
              ? `
                <p class="mt-2 text-[11px] text-rose-700">
                  سبب الرفض: ${escapeHtml(document.rejection_reason)}
                </p>
              `
              : ''
          }

          <div class="mt-4 flex flex-wrap gap-2">
            <a
              href="${escapeHtml(document.file_url)}"
              target="_blank"
              rel="noopener"
              class="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-white"
            >
              فتح الملف
            </a>

            <button
              type="button"
              data-profile-document-id="${document.id}"
              class="approve-profile-document rounded-lg border border-emerald-200 px-3 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
            >
              اعتماد
            </button>

            <button
              type="button"
              data-profile-document-id="${document.id}"
              class="reject-profile-document rounded-lg border border-rose-200 px-3 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
            >
              رفض
            </button>
          </div>
        </article>
      `).join('')}
    </div>
  `;

  document.querySelectorAll('.approve-profile-document').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await reviewItem(
          'profile',
          button.dataset.profileDocumentId,
          'APPROVED'
        );

        await loadCandidate();
      } catch (error) {
        notify(error.message);
      }
    });
  });

  document.querySelectorAll('.reject-profile-document').forEach((button) => {
    button.addEventListener('click', () => {
      openReviewModal(
        'profile',
        button.dataset.profileDocumentId,
        'مستند الملف الشخصي'
      );
    });
  });
}

function renderCandidateAttachments(attachments = []) {
  const container = document.querySelector('#candidateAttachmentsList');

  if (!attachments.length) {
    container.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
        لم يتم إرسال أي مستندات للمرشح حتى الآن.
      </div>
    `;
    return;
  }

  container.innerHTML = attachments.map((attachment) => `
    <a
      href="${escapeHtml(attachment.file_url)}"
      target="_blank"
      rel="noopener"
      class="rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-brand-gold hover:bg-brand-lightGold"
    >
      <p class="text-xs font-bold text-slate-800">
        ${attachmentTypeText(attachment.attachment_type)}
      </p>

      <p class="mt-1 text-[11px] text-slate-500">
        ${escapeHtml(attachment.original_name || 'فتح المستند')}
      </p>

      ${
        attachment.note
          ? `
            <p class="mt-2 text-[11px] text-slate-600">
              ${escapeHtml(attachment.note)}
            </p>
          `
          : ''
      }

      <p class="mt-3 text-[10px] font-bold text-brand-darkGold">
        ${formatDate(attachment.created_at)} ← فتح
      </p>
    </a>
  `).join('');
}

function renderStatusHistory(history = []) {
  const container = document.querySelector('#candidateStatusHistory');

  if (!history.length) {
    container.textContent = 'لا يوجد سجل حالات حتى الآن.';
    return;
  }

  container.innerHTML = `
    <div class="space-y-3">
      ${history.map((item) => `
        <div class="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
          <p class="font-bold text-slate-800">
            ${candidateStatusText(item.from_status)} ←
            ${candidateStatusText(item.to_status)}
          </p>

          <p class="mt-1 text-slate-500">
            ${escapeHtml(item.reason || 'بدون ملاحظة')}
            — ${formatDate(item.changed_at)}
          </p>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadCandidate() {
  const data = await api(
    `/api/courses/${courseId}/candidates/${candidateId}`
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

  renderForms(candidate.forms || []);
  renderProfileDocuments(candidate.profile_documents || []);
  renderCandidateAttachments(candidate.attachments || []);
  renderStatusHistory(candidate.status_history || []);

  document.querySelector('#backToCourseLink').href =
    `./manage-course.html?id=${courseId}`;

  document.querySelector('#backToCourseButton').href =
    `./manage-course.html?id=${courseId}`;
}

async function updateCandidateStatus(status, reason = null) {
  await api(
    `/api/courses/${courseId}/candidates/${candidateId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status, reason }),
    }
  );

  await loadCandidate();
}

async function uploadCandidateAttachment(event) {
  event.preventDefault();

  const attachmentType = document.querySelector(
    '#candidateAttachmentType'
  ).value;

  const fileInput = document.querySelector(
    '#candidateAttachmentFile'
  );

  const file = fileInput.files[0];

  if (!attachmentType || !file) {
    showAttachmentMessage(
      'اختر نوع المستند والملف أولًا.'
    );

    return;
  }

  const button = document.querySelector(
    '#uploadCandidateAttachmentButton'
  );

  const formData = new FormData();

  formData.append('attachmentType', attachmentType);
  formData.append(
    'note',
    document.querySelector('#candidateAttachmentNote').value.trim()
  );
  formData.append('attachmentFile', file);

  button.disabled = true;
  button.textContent = 'جارٍ الرفع والإرسال...';

  try {
    const data = await api(
      `/api/courses/${courseId}/candidates/${candidateId}/attachments`,
      {
        method: 'POST',
        body: formData,
      }
    );

    showAttachmentMessage(
      data.message || 'تم رفع المستند وإرساله للمرشح.',
      'success'
    );

    document.querySelector('#candidateAttachmentForm').reset();

    await loadCandidate();
  } catch (error) {
    showAttachmentMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'رفع وإرسال للمرشح';
  }
}

document.querySelector('#preliminaryAcceptButton').addEventListener(
  'click',
  () => {
    updateCandidateStatus('PRELIMINARILY_ACCEPTED')
      .catch((error) => notify(error.message));
  }
);

document.querySelector('#confirmCandidateButton').addEventListener(
  'click',
  () => {
    updateCandidateStatus('CONFIRMED')
      .catch((error) => notify(error.message));
  }
);

document.querySelector('#finalRejectCandidateButton').addEventListener(
  'click',
  () => {
    document.querySelector('#finalRejectionReason').value = '';
    hideModalError('#finalRejectModalError');
    showModal('#finalRejectModal');
  }
);

document.querySelector('#closeFinalRejectModalButton').addEventListener(
  'click',
  () => closeModal('#finalRejectModal')
);

document.querySelector('#confirmFinalRejectButton').addEventListener(
  'click',
  async () => {
    const reason = document
      .querySelector('#finalRejectionReason')
      .value
      .trim();

    if (!reason) {
      showModalError(
        '#finalRejectModalError',
        'سبب الرفض النهائي مطلوب.'
      );
      return;
    }

    try {
      await updateCandidateStatus('REJECTED', reason);
      closeModal('#finalRejectModal');
    } catch (error) {
      showModalError('#finalRejectModalError', error.message);
    }
  }
);

document.querySelector('#closeResubmissionModalButton').addEventListener(
  'click',
  () => closeModal('#resubmissionModal')
);

document.querySelector('#confirmResubmissionButton').addEventListener(
  'click',
  async () => {
    const reason = document
      .querySelector('#resubmissionReason')
      .value
      .trim();

    if (!reason) {
      showModalError(
        '#resubmissionModalError',
        'يرجى كتابة سبب الرفض للموظف.'
      );
      return;
    }

    if (!selectedReview) {
      showModalError(
        '#resubmissionModalError',
        'لم يتم تحديد المستند أو الاستمارة.'
      );
      return;
    }

    try {
      await reviewItem(
        selectedReview.kind,
        selectedReview.id,
        'REJECTED',
        reason
      );

      closeModal('#resubmissionModal');

      await loadCandidate();
    } catch (error) {
      showModalError('#resubmissionModalError', error.message);
    }
  }
);

document.querySelector('#candidateAttachmentForm').addEventListener(
  'submit',
  uploadCandidateAttachment
);

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
    setText('#candidateName', error.message);
  }
}

initialize();
