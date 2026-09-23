import { protectPage } from '../../shared/auth-guard.js';
import { bindLiveFilters } from '../../shared/live-filters.js';
import {
  api,
  escapeHtml,
  formatDate,
  courseStatusText,
  logout,
} from './course-api.js';

const grid = document.querySelector('#coursesGrid');
const countText = document.querySelector('#coursesCountText');
const form = document.querySelector('#coursesFiltersForm');
const searchInput = document.querySelector('#courseSearchInput');
const typeFilter = document.querySelector('#courseTypeFilter');
const statusFilter = document.querySelector('#courseStatusFilter');
const resetButton = document.querySelector('#resetCoursesFiltersButton');
const logoutButton = document.querySelector('#logoutButton');

function statusClass(status) {
  const classes = {
    ACTIVE: 'bg-brand-lightGold text-brand-darkGold',
    OPEN_FOR_NOMINATION: 'bg-brand-lightGold text-brand-darkGold',
    NOMINATION_CLOSED: 'bg-amber-50 text-amber-700',
    CANDIDATE_PROCESSING: 'bg-violet-50 text-violet-700',
    DRAFT: 'bg-slate-100 text-slate-600',
    COMPLETED: 'bg-emerald-50 text-emerald-700',
    ARCHIVED: 'bg-blue-50 text-blue-700',
    CANCELLED: 'bg-rose-50 text-rose-700',
  };

  return classes[status] || 'bg-slate-100 text-slate-600';
}

function renderCourses(courses) {
  if (!courses.length) {
    grid.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
        لا توجد دورات مطابقة للبحث الحالي.
      </div>
    `;
    return;
  }

  grid.innerHTML = courses.map((course) => `
    <a
      href="./manage-course.html?id=${course.id}"
      class="group block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-gold hover:shadow-md"
    >
      <article class="flex h-full flex-col justify-between">
        <div>
      <div class="flex items-center justify-between gap-3">
        <span class="rounded-lg px-2.5 py-1 text-[11px] font-bold ${statusClass(course.status)}">
          ${courseStatusText(course.status)}
        </span>

        <span class="text-[11px] text-slate-400">
          ${course.candidates_count || 0} مرشح
        </span>
      </div>

      <p class="mt-5 text-[11px] font-semibold text-brand-gold">
        ${course.course_type === 'MISSION' ? 'مهمة' : 'دورة تدريبية'}
      </p>

      <h4 class="mt-1 text-sm font-bold text-slate-900 transition group-hover:text-brand-gold">
        ${escapeHtml(course.title)}
      </h4>

      <p class="mt-2 line-clamp-2 text-xs leading-6 text-slate-500">
        ${escapeHtml(course.description || 'لا يوجد وصف للدورة.')}
      </p>
        </div>

      <div class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <span class="text-[11px] text-slate-500">
          البدء: ${formatDate(course.start_date)}
        </span>

        <span class="text-xs font-bold text-slate-800 transition group-hover:text-brand-gold">
          التفاصيل ←
        </span>
      </div>
      </article>
    </a>
  `).join('');
}

async function loadCourses() {
  grid.innerHTML = `
    <div class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-xs text-slate-400 md:col-span-2 xl:col-span-3">
      جارٍ تحميل الدورات...
    </div>
  `;

  const params = new URLSearchParams();

  if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
  if (typeFilter.value) params.set('type', typeFilter.value);
  
  // إذا المستخدم اختار حالة معينة يدوياً من الفلتر، نرسلها، وإلا لا
  if (statusFilter.value) {
    params.set('status', statusFilter.value);
  }

  try {
    const data = await api(`/api/courses?${params.toString()}`);
    const courses = (data.courses || []).filter(
      (course) => course.status !== 'ARCHIVED' && course.status !== 'CANCELLED'
    );

    countText.textContent = `إجمالي الدورات: ${courses.length}`;
    renderCourses(courses);
  } catch (error) {
    countText.textContent = 'تعذر تحميل الدورات';

    grid.innerHTML = `
      <div class="rounded-xl border border-rose-200 bg-rose-50 px-5 py-8 text-center text-xs text-rose-700 md:col-span-2 xl:col-span-3">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadCourses();
});
bindLiveFilters('#coursesFiltersForm', loadCourses);

resetButton.addEventListener('click', () => {
  form.reset();
  loadCourses();
});

logoutButton.addEventListener('click', logout);

async function initialize() {
  const session = await protectPage(['SUPER_ADMIN']);
  if (!session) return;

  loadCourses();
}

initialize();
