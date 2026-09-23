/**
 * يربط نافذة إضافة مرشح مباشر للمهمة بموظفي الأقسام المخصصة لها.
 * يبقى التحقق النهائي من المقاعد والقسم وحالة المهمة في الخادم.
 */
export function setupDirectCandidate({ course, candidates, api, onError }) {
  const openButton = document.querySelector('#openDirectCandidateModalButton');
  const modal = document.querySelector('#directCandidateModal');
  const select = document.querySelector('#directCandidateEmployeeId');
  const closeButton = document.querySelector('#closeDirectCandidateModalButton');
  const confirmButton = document.querySelector('#confirmDirectCandidateButton');
  const errorBox = document.querySelector('#directCandidateModalError');

  if (!openButton || !modal || course.course_type !== 'MISSION') return;

  const isClosed = ['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(course.status);
  const inactiveCandidateStatuses = ['REJECTED', 'WITHDRAWN', 'REMOVED', 'CANCELLED'];
  const activeCandidates = candidates.filter(
    (candidate) => !inactiveCandidateStatuses.includes(candidate.status)
  );
  const remainingSeats = Math.max(
    Number(course.total_seats || 0) - activeCandidates.length,
    0
  );

  openButton.disabled = isClosed || remainingSeats === 0;
  openButton.textContent = remainingSeats
    ? `إضافة مرشح جديد — متبقي ${remainingSeats}`
    : 'اكتملت مقاعد المهمة';

  const closeModal = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  };

  closeButton.onclick = closeModal;

  openButton.onclick = async () => {
    errorBox.classList.add('hidden');
    select.innerHTML = '<option value="">جارٍ تحميل الموظفين...</option>';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
      const departmentIds = [
        ...new Set((course.allocations || []).map((item) => Number(item.department_id))),
      ].filter(Number.isInteger);
      const responses = await Promise.all(
        departmentIds.map((departmentId) =>
          api(`/api/courses/eligible-employees?departmentId=${departmentId}`)
        )
      );
      const existingIds = new Set(
        activeCandidates.map((item) => Number(item.employee_user_id))
      );
      const employees = responses
        .flatMap((response) => response.employees || [])
        .filter((employee, index, items) =>
          !existingIds.has(Number(employee.id)) &&
          items.findIndex((item) => Number(item.id) === Number(employee.id)) === index
        );

      select.innerHTML = employees.length
        ? `<option value="">اختر الموظف</option>${employees.map((employee) =>
            `<option value="${employee.id}">${employee.full_name} — ${employee.employee_number || 'بدون رقم'}</option>`
          ).join('')}`
        : '<option value="">لا يوجد موظفون متاحون</option>';
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  };

  confirmButton.onclick = async () => {
    const employeeUserId = Number(select.value);
    if (!Number.isInteger(employeeUserId) || employeeUserId <= 0) {
      errorBox.textContent = 'اختر موظفًا أولًا.';
      errorBox.classList.remove('hidden');
      return;
    }

    confirmButton.disabled = true;
    try {
      await api(`/api/courses/${course.id}/candidates/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeUserId }),
      });
      window.location.reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
      onError?.(error.message);
      confirmButton.disabled = false;
    }
  };
}
