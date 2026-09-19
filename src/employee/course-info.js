import { protectPage } from '../shared/auth-guard.js';

const courseId = new URLSearchParams(window.location.search).get('id');

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

function showFormsMessage(message, type = 'error') {
  const element = document.querySelector('#formsMessage');

  element.textContent = message;
  element.className = type === 'success'
    ? 'mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700'
    : 'mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700';

  element.classList.remove('hidden');
}

function renderAttachments(attachments) {
  const container = document.querySelector('#courseAttachmentsList');

  if (!attachments.length) {
    container.textContent = 'لا توجد أجندة أو مرفقات حاليًا.';
    return;
  }

  container.innerHTML = attachments.map((attachment) => `
    <a
      href="${escapeHtml(attachment.file_url)}"
      target="_blank"
      rel="noopener"
      class="ml-2 mb-2 inline-block rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-brand-darkGold"
    >
      ${escapeHtml(attachment.attachment_type)}:
      ${escapeHtml(attachment.original_name)}
    </a>
  `).join('');
}

/** يعرض الملفات المرسلة لهذا المرشح فقط، وليس المرفقات العامة للدورة. */
function renderCandidateAttachments(attachments = []) {
  const container = document.querySelector('#candidateAttachmentsList');
  if (!attachments.length) {
    container.textContent = 'لم تُرسل لك تذكرة أو تأشيرة أو مستندات خاصة حتى الآن.';
    return;
  }

  container.innerHTML = attachments.map((attachment) => `
    <a href="${escapeHtml(attachment.file_url)}" target="_blank" rel="noopener"
       class="ml-2 mb-2 inline-block rounded-lg bg-slate-50 px-3 py-2 font-semibold text-brand-darkGold">
      ${escapeHtml(attachment.attachment_type)}: ${escapeHtml(attachment.original_name)}
    </a>
  `).join('');
}

function renderForms(forms) {
  const container = document.querySelector('#courseFormsList');

  if (!forms.length) {
    container.innerHTML = `
      <p class="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-400">
        لا توجد استمارات مطلوبة لهذه الدورة.
      </p>
    `;
    return;
  }

  container.innerHTML = forms.map((form) => `
    <article class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-xs font-bold text-slate-800">${escapeHtml(form.title)}</p>
          <p class="mt-1 text-[11px] ${Number(form.is_required) ? 'text-rose-600' : 'text-slate-500'}">
            ${Number(form.is_required) ? 'استمارة إلزامية' : 'استمارة اختيارية'}
          </p>
          <p class="mt-1 text-[11px] text-slate-500">
  الحالة: ${form.submission_status || 'لم تُرفع بعد'}
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

      <div class="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          id="formFile-${form.id}"
          type="file"
          accept=".pdf,image/png,image/jpeg,image/jpg"
          class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px]"
        />

        <button
          type="button"
          data-form-id="${form.id}"
          class="upload-form-button rounded-lg bg-brand-gold px-4 py-2 text-[11px] font-bold text-white"
        >
          رفع النسخة المعبأة
        </button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('.upload-form-button').forEach((button) => {
    button.addEventListener('click', () => {
      uploadForm(Number(button.dataset.formId), button);
    });
  });
}

async function uploadForm(formId, button) {
  const fileInput = document.querySelector(`#formFile-${formId}`);
  const file = fileInput.files[0];

  if (!file) {
    showFormsMessage('اختر ملف الاستمارة أولًا.');
    return;
  }

  const formData = new FormData();
  formData.append('formFile', file);

  button.disabled = true;
  button.textContent = 'جارٍ الرفع...';

  try {
    const data = await api(
      `/api/courses/${courseId}/forms/${formId}/submission`,
      {
        method: 'POST',
        body: formData,
      }
    );

    showFormsMessage(
      data.message || 'تم رفع الاستمارة بنجاح.',
      'success'
    );

    fileInput.value = '';
    await loadCourse();
  } catch (error) {
    showFormsMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'رفع النسخة المعبأة';
  }
}

function fillPage(data) {
  const course = data.course || {};
  const candidate = data.candidate || {};

  document.querySelector('#courseTitle').textContent =
    course.title || '—';

  document.querySelector('#courseNumber').textContent =
    course.course_no || 'بدون رقم';

  document.querySelector('#providerName').textContent =
    course.provider || '—';

  document.querySelector('#courseLocation').textContent =
    course.location || '—';

  document.querySelector('#courseDates').textContent =
    `${formatDate(course.start_date)} إلى ${formatDate(course.end_date)}`;

  document.querySelector('#courseDescription').textContent =
    course.description || 'لا يوجد وصف.';

  document.querySelector('#courseTypeBadge').textContent =
    course.course_type === 'MISSION'
      ? 'مهمة / بعثة'
      : 'دورة تدريبية';

  document.querySelector('#courseStatusBadge').textContent =
    course.status || '—';

  document.querySelector('#candidateStatus').textContent =
    candidate.status || '—';

  renderForms(data.forms || []);
  renderCandidateAttachments(data.candidateAttachments || []);
  renderAttachments(data.attachments || []);
}

/** يجدد بيانات الدورة وحالة الاستمارات بعد أي رفع ناجح. */
async function loadCourse() {
  const data = await api(`/api/courses/${courseId}`);
  fillPage(data);
}

async function initialize() {
  const user = await protectPage(['EMPLOYEE']);
  if (!user) return;

  if (!courseId) {
    window.location.replace('./main-courses.html');
    return;
  }

  try {
    await loadCourse();
  } catch (error) {
    document.querySelector('#courseTitle').textContent =
      error.message || 'تعذر تحميل تفاصيل الدورة.';
  }
}

initialize();
