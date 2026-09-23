/** يحدّث النتائج عند تغيير الفلاتر فورًا، مع تأخير قصير أثناء الكتابة. */
export function bindLiveFilters(containerSelector, refresh) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  let timer;
  container.addEventListener('input', (event) => {
    if (!event.target.matches('input[type="search"], input[type="text"]')) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  });
  container.addEventListener('change', (event) => {
    if (!event.target.matches('select, input[type="date"]')) return;
    clearTimeout(timer);
    refresh();
  });
}
